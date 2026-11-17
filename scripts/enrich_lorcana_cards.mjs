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

const LORCANA_JSON_URL = 'https://lorcanajson.org/files/current/en/allCards.json';

function setCodeForLorcanaSet(key) {
  const k = String(key).trim();
  if (/^\d+$/.test(k)) return `LOR-${k.padStart(2, '0')}`;
  return `LOR-${k.toUpperCase()}`;
}

function buildUniqueCardNumber(card) {
  const firstToken = String(card.fullIdentifier || '').split(/[•/\s]+/)[0] || '';
  const m = firstToken.match(/^(\d+)([A-Za-z]*)$/);
  const baseNum = m ? `${m[1].padStart(3, '0')}${m[2]}` : String(card.number).padStart(3, '0');
  const variant = card.variant ? String(card.variant).trim() : '';
  const withVariant = variant && !baseNum.toLowerCase().endsWith(variant.toLowerCase()) ? `${baseNum}${variant}` : baseNum;
  if (card.promoGrouping) {
    return `${withVariant}-${String(card.promoGrouping).trim().toUpperCase()}`;
  }
  return withVariant;
}

function deriveSpecialRarity(card) {
  if (!card) return null;
  const pg = String(card.promoGrouping || '').toUpperCase();
  const fullId = String(card.fullIdentifier || '').toUpperCase();
  const srcCat = String(card.promoSourceCategory || '').toLowerCase();
  const setCode = String(card.setCode || '').toUpperCase();

  if (pg.includes('D100') || fullId.includes('D100')) return 'D100';
  if (pg.includes('D23') || fullId.includes('D23')) return 'D23';
  if (pg.startsWith('C') || srcCat.includes('challenge')) return 'CHALLENGE';
  if (setCode.startsWith('Q')) return 'QUEST';
  if (pg) return 'PROMO';
  return null;
}

function deriveLegalFormats(card) {
  const allowed = card.allowedInFormats || {};
  const res = [];
  if (allowed.Core?.allowed) res.push('Core Constructed');
  if (allowed.Infinity?.allowed) res.push('Infinity');
  return res;
}

function buildCardPayload(card, setId, uniqueCardNumber) {
  const name = card.version ? `${card.name} - ${card.version}` : card.name;
  const subtype = Array.isArray(card.subtypes) && card.subtypes.length > 0
    ? card.subtypes.join(' • ')
    : (card.subtypesText || null);

  const abilities = Array.isArray(card.keywordAbilities) && card.keywordAbilities.length > 0
    ? card.keywordAbilities
    : [];

  const legalFormats = deriveLegalFormats(card);
  const specialRarity = deriveSpecialRarity(card);
  const fullIdentifier = card.fullIdentifier ? String(card.fullIdentifier).replace(/\s*•\s*/g, ' ').trim() : null;

  const metadata = {
    version: card.version || null,
    inkwell: typeof card.inkwell === 'boolean' ? card.inkwell : null,
    move_cost: typeof card.moveCost === 'number' ? card.moveCost : null,
    lore: typeof card.lore === 'number' ? card.lore : null,
    strength: typeof card.strength === 'number' ? card.strength : null,
    willpower: typeof card.willpower === 'number' ? card.willpower : null,
    collector_number: fullIdentifier,
    special_rarity: specialRarity,
    promo_grouping: card.promoGrouping || null,
    flavor_text: card.flavorText || null,
    legal_formats: legalFormats,
    abilities,
    subtypes: Array.isArray(card.subtypes) ? card.subtypes : [],
    cardmarket_id: card.externalLinks?.cardmarketId || null,
  };

  return {
    set_id: setId,
    card_number: uniqueCardNumber,
    name: String(name || '').slice(0, 150),
    rarity: card.rarity || 'Common',
    card_type: card.type || 'Character',
    cost: typeof card.cost === 'number' ? card.cost : 0,
    energy: typeof card.lore === 'number' ? String(card.lore) : null,
    might: typeof card.strength === 'number' ? String(card.strength) : null,
    might_bonus: typeof card.willpower === 'number' ? card.willpower : null,
    domain: card.color || null,
    subtype,
    text: card.fullText || null,
    artist: card.artistsText || null,
    image_path: card.images?.full || card.images?.thumbnail || null,
    game: 'lorcana',
    is_archived: false,
    metadata,
  };
}

async function main() {
  console.log(`Starting Disney Lorcana enrichment & sync${isDryRun ? ' [DRY RUN]' : ''}...`);

  const { error: schemaError } = await supabase
    .from('cards')
    .select('id, metadata')
    .eq('game', 'lorcana')
    .limit(1);

  if (schemaError) {
    console.warn(`Schema check warning (${schemaError.code}): ${schemaError.message}`);
    if (!isDryRun) {
      console.error('\nRun supabase/migrations/20261117000000_onepiece_card_fields.sql in Supabase SQL Editor first so cards.metadata exists.');
      process.exit(1);
    }
  }

  console.log('Fetching LorcanaJSON allCards.json...');
  const res = await fetch(LORCANA_JSON_URL, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching LorcanaJSON`);
  const payload = await res.json();
  const rawSets = payload.sets || {};
  const rawCards = payload.cards || [];
  console.log(`Loaded ${Object.keys(rawSets).length} sets and ${rawCards.length} cards from LorcanaJSON.`);

  // Fetch existing Lorcana sets in DB
  const { data: existingSets } = await supabase
    .from('sets')
    .select('id, code, name, release_date')
    .eq('game', 'lorcana');

  const setMap = new Map();
  for (const s of existingSets || []) {
    setMap.set(String(s.code).toUpperCase(), s.id);
  }

  if (!isDryRun) {
    for (const [key, info] of Object.entries(rawSets)) {
      const code = setCodeForLorcanaSet(key);
      const { data, error } = await supabase
        .from('sets')
        .upsert(
          {
            code,
            name: info.name,
            game: 'lorcana',
            release_date: info.releaseDate || null,
          },
          { onConflict: 'code' }
        )
        .select('id, code')
        .single();
      if (error) {
        console.error(`Set upsert failed (${code}): ${error.message}`);
      } else if (data) {
        setMap.set(code.toUpperCase(), data.id);
      }
    }
  }

  // Fetch all existing Lorcana cards from DB
  const existingDbCards = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('cards')
      .select('id, set_id, card_number, image_path')
      .eq('game', 'lorcana')
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
  const toUpdate = [];
  const toInsert = [];

  for (const card of rawCards) {
    const setCode = setCodeForLorcanaSet(card.setCode);
    const setId = setMap.get(setCode.toUpperCase()) || `DRY_${setCode}`;
    let uniqueNumber = buildUniqueCardNumber(card);
    let dedupeKey = `${setCode}_${uniqueNumber.toUpperCase()}`;
    let suffixIdx = 2;
    while (usedKeys.has(dedupeKey)) {
      uniqueNumber = `${buildUniqueCardNumber(card)}-${suffixIdx++}`;
      dedupeKey = `${setCode}_${uniqueNumber.toUpperCase()}`;
    }
    usedKeys.add(dedupeKey);

    const rowData = buildCardPayload(card, setId, uniqueNumber);
    const exactMatch = dbBySetAndNumber.get(`${setId}_${uniqueNumber.toUpperCase()}`);
    const legacyMatch =
      !exactMatch && !card.promoGrouping && !card.variant
        ? dbBySetAndNumber.get(`${setId}_${String(card.number).padStart(3, '0')}`)
        : null;
    const match = exactMatch || legacyMatch;

    if (match) {
      // Preserve custom/R2 image paths if non-HTTP external
      const img = match.image_path && !String(match.image_path).startsWith('http')
        ? match.image_path
        : rowData.image_path;
      toUpdate.push({ id: match.id, ...rowData, image_path: img });
    } else {
      toInsert.push(rowData);
    }
  }

  console.log(`\nPlan Summary:`);
  console.log(`  Existing DB rows      : ${existingDbCards.length}`);
  console.log(`  Matched to update     : ${toUpdate.length}`);
  console.log(`  New cards to insert   : ${toInsert.length}`);
  console.log(`  Total post-sync cards : ${toUpdate.length + toInsert.length}`);

  const sample = [...toUpdate, ...toInsert].slice(0, 3);
  console.log('\nSample payloads:');
  console.log(JSON.stringify(sample, null, 2));

  if (isDryRun) {
    console.log('\nDry run complete. No database rows modified.');
    return;
  }

  let updatedCount = 0;
  const UPDATE_BATCH = 25;
  for (let i = 0; i < toUpdate.length; i += UPDATE_BATCH) {
    const slice = toUpdate.slice(i, i + UPDATE_BATCH);
    await Promise.all(
      slice.map(async (item) => {
        const { id, ...fields } = item;
        const { error } = await supabase.from('cards').update(fields).eq('id', id);
        if (error) console.error(`Update failed ${id} (${fields.card_number}): ${error.message}`);
        else updatedCount++;
      })
    );
    if ((i + UPDATE_BATCH) % 500 === 0 || i + UPDATE_BATCH >= toUpdate.length) {
      console.log(`Updates: ${updatedCount}/${toUpdate.length}`);
    }
  }

  let insertedCount = 0;
  const INSERT_BATCH = 100;
  for (let i = 0; i < toInsert.length; i += INSERT_BATCH) {
    const slice = toInsert.slice(i, i + INSERT_BATCH);
    const { error } = await supabase.from('cards').insert(slice);
    if (error) console.error(`Insert batch ${i} failed: ${error.message}`);
    else insertedCount += slice.length;
    if ((i + INSERT_BATCH) % 500 === 0 || i + INSERT_BATCH >= toInsert.length) {
      console.log(`Inserts: ${insertedCount}/${toInsert.length}`);
    }
  }

  console.log(`\nDone. Updated=${updatedCount}, Inserted=${insertedCount}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
