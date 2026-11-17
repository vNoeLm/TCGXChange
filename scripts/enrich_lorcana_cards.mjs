import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import vm from 'node:vm';

dotenv.config();

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.');
  process.exit(1);
}

const isDryRun = process.argv.includes('--dry-run');
const supabase = createClient(supabaseUrl, supabaseKey);

const OFFICIAL_LORCANA_URL = 'https://cards.disneylorcana.com/en-US/';

function setCodeForOfficialSet(setId) {
  const id = String(setId || '').trim().toLowerCase();
  const setMatch = id.match(/^set(\d+)$/);
  if (setMatch) return `LOR-${setMatch[1].padStart(2, '0')}`;
  const questMatch = id.match(/^quest(\d+)$/);
  if (questMatch) return `LOR-Q${questMatch[1]}`;
  if (id === 'gateway1') return 'LOR-GW1';
  const gwMatch = id.match(/^gateway(\d+)$/);
  if (gwMatch) return `LOR-GW${gwMatch[1]}`;
  return `LOR-${id.toUpperCase()}`;
}

function titleCaseWord(s) {
  const clean = String(s || '').trim().toLowerCase();
  if (!clean) return '';
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function normalizeCardType(rawType) {
  const t = String(rawType || '').trim().toLowerCase();
  switch (t) {
    case 'characters':
    case 'character':
      return 'Character';
    case 'actions':
    case 'action':
      return 'Action';
    case 'items':
    case 'item':
      return 'Item';
    case 'locations':
    case 'location':
      return 'Location';
    case 'supplies':
      return 'Supplies';
    default:
      return titleCaseWord(rawType) || 'Character';
  }
}

function normalizeRarity(rawRarity) {
  const r = String(rawRarity || '').trim().toUpperCase();
  switch (r) {
    case 'COMMON':
      return 'Common';
    case 'UNCOMMON':
      return 'Uncommon';
    case 'RARE':
      return 'Rare';
    case 'SUPER':
      return 'Super';
    case 'LEGENDARY':
      return 'Legendary';
    case 'EPIC':
      return 'Epic';
    case 'ENCHANTED':
      return 'Enchanted';
    case 'ICONIC':
      return 'Iconic';
    case 'SPECIAL':
      return 'Special';
    default:
      return r ? titleCaseWord(r) : 'Common';
  }
}

function primaryOfficialSetId(card) {
  const ident = String(card.card_identifier || '').trim();
  const enMatch = ident.match(/\bEN\s+([A-Za-z0-9]+)$/);
  if (enMatch) {
    const token = enMatch[1].toUpperCase();
    if (/^\d+$/.test(token)) return `set${token}`;
    const qMatch = token.match(/^Q(\d+)$/);
    if (qMatch) return `quest${qMatch[1]}`;
  }
  return card.card_sets?.[0]?.id || null;
}

function deriveSpecialRarity(card) {
  const ident = String(card.card_identifier || '').toUpperCase();
  const primarySetId = String(primaryOfficialSetId(card) || '').toLowerCase();
  if (ident.includes('/D100')) return 'D100';
  if (/\/D\d+/.test(ident)) return 'D23';
  if (/\/C\d+/.test(ident)) return 'CHALLENGE';
  if (primarySetId.startsWith('quest') || /\bEN Q\d+\b/.test(ident)) return 'QUEST';
  if (/\/(P[A-Z]*\d*|RPH)\b/.test(ident)) return 'PROMO';
  return null;
}

function deriveLegalFormats(rotationState) {
  switch (String(rotationState || '').trim()) {
    case 'CoreConstructed':
      return ['Core Constructed', 'Infinity'];
    case 'InfinityConstructed':
      return ['Infinity'];
    case 'Banned':
      return ['Banned'];
    default:
      return [];
  }
}

function baseCardNumberFromOfficial(card) {
  const ident = String(card.card_identifier || '').trim();
  const m = ident.match(/^(\d+)([A-Za-z]*)\s*\/\s*([A-Za-z0-9]+)/);
  if (!m) {
    return `SUP-${card.culture_invariant_id}`;
  }
  const padded = `${m[1].padStart(3, '0')}${m[2]}`;
  const denom = m[3].toUpperCase();
  if (/^\d+$/.test(denom)) {
    return padded;
  }
  return `${padded}-${denom}`;
}

function getOfficialImageUrl(card) {
  const variants = Array.isArray(card.variants) ? card.variants : [];
  const regular = variants.find((v) => v?.variant_id === 'Regular') || variants[0];
  const base = regular?.detail_image_url;
  return base ? `${base}card` : null;
}

async function fetchOfficialLorcanaCatalog() {
  console.log(`Fetching official catalog from ${OFFICIAL_LORCANA_URL}...`);
  const res = await fetch(OFFICIAL_LORCANA_URL, { signal: AbortSignal.timeout(45000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching official Lorcana catalog`);
  const html = await res.text();

  const matches = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
  const ctx = { $_TSR: { c: [], p: () => {} }, $R: { tsr: [] } };
  vm.createContext(ctx);

  let parsed = false;
  for (const m of matches) {
    const code = m[1];
    if (code.includes('$_TSR.router=') && code.includes('culture_invariant_id')) {
      vm.runInContext(code, ctx);
      parsed = true;
      break;
    }
  }
  if (!parsed) throw new Error('Could not locate $_TSR.router cardsData payload in official HTML');

  const routeMatch = ctx.$_TSR.router?.matches?.find((x) => x?.l?.cardsData);
  const cardsData = routeMatch?.l?.cardsData;
  if (!cardsData || !Array.isArray(cardsData.cards)) {
    throw new Error('cardsData.cards missing in parsed official payload');
  }

  return {
    cards: cardsData.cards,
    setNames: cardsData.setNames || {},
  };
}

function buildCardPayload(card, setId, uniqueCardNumber) {
  const name = card.subtitle ? `${card.name} - ${card.subtitle}` : card.name;
  const subtype = Array.isArray(card.subtypes) && card.subtypes.length > 0
    ? card.subtypes.join(' • ')
    : null;
  const abilities = Array.isArray(card.abilities) ? card.abilities : [];
  const legalFormats = deriveLegalFormats(card.set_rotation_state);
  const specialRarity = deriveSpecialRarity(card);
  const domainColors = Array.isArray(card.magic_ink_colors)
    ? card.magic_ink_colors.map(titleCaseWord).filter(Boolean).join(', ')
    : null;

  const metadata = {
    official_id: card.culture_invariant_id ?? null,
    version: card.subtitle || null,
    inkwell: typeof card.ink_convertible === 'boolean' ? card.ink_convertible : null,
    move_cost: typeof card.move_cost === 'number' ? card.move_cost : null,
    lore: typeof card.quest_value === 'number' ? card.quest_value : null,
    strength: typeof card.strength === 'number' ? card.strength : null,
    willpower: typeof card.willpower === 'number' ? card.willpower : null,
    collector_number: card.card_identifier || null,
    special_rarity: specialRarity,
    flavor_text: card.flavor_text || null,
    legal_formats: legalFormats,
    abilities,
    subtypes: Array.isArray(card.subtypes) ? card.subtypes : [],
    searchable_keywords: Array.isArray(card.searchable_keywords) ? card.searchable_keywords : [],
  };

  return {
    set_id: setId,
    card_number: uniqueCardNumber,
    name: String(name || '').slice(0, 150),
    rarity: normalizeRarity(card.rarity),
    card_type: normalizeCardType(card.card_type),
    cost: typeof card.ink_cost === 'number' ? card.ink_cost : 0,
    energy: typeof card.quest_value === 'number' ? String(card.quest_value) : null,
    might: typeof card.strength === 'number' ? String(card.strength) : null,
    might_bonus: typeof card.willpower === 'number' ? card.willpower : null,
    domain: domainColors || null,
    subtype,
    text: card.rules_text || null,
    artist: card.author || null,
    image_path: getOfficialImageUrl(card),
    game: 'lorcana',
    is_archived: false,
    metadata,
  };
}

async function main() {
  console.log(`Starting Disney Lorcana official enrichment & sync${isDryRun ? ' [DRY RUN]' : ''}...`);

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

  const { cards: rawCards, setNames } = await fetchOfficialLorcanaCatalog();
  console.log(`Loaded ${Object.keys(setNames).length} sets and ${rawCards.length} cards from official Disney Lorcana catalog.`);

  const { data: existingSets } = await supabase
    .from('sets')
    .select('id, code, name, release_date')
    .eq('game', 'lorcana');

  const setMap = new Map();
  for (const s of existingSets || []) {
    setMap.set(String(s.code).toUpperCase(), s.id);
  }

  // Upsert official sets (ensuring Set 8..14, Quest 2..3, Gateway 1 exist)
  const setEntries = Object.entries(setNames);
  if (!isDryRun) {
    for (const [officialSetId, info] of setEntries) {
      const code = setCodeForOfficialSet(officialSetId);
      const { data, error } = await supabase
        .from('sets')
        .upsert(
          {
            code,
            name: info.name,
            game: 'lorcana',
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

  // Fetch all existing Lorcana cards in DB
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
    const primarySetId = primaryOfficialSetId(card);
    if (!primarySetId) continue;

    const setCode = setCodeForOfficialSet(primarySetId);
    const setId = setMap.get(setCode.toUpperCase()) || `DRY_${setCode}`;
    const baseNum = baseCardNumberFromOfficial(card);

    let uniqueNumber = baseNum;
    let dedupeKey = `${setCode}_${uniqueNumber.toUpperCase()}`;
    let suffixIdx = 2;
    while (usedKeys.has(dedupeKey)) {
      uniqueNumber = `${baseNum}-${suffixIdx++}`;
      dedupeKey = `${setCode}_${uniqueNumber.toUpperCase()}`;
    }
    usedKeys.add(dedupeKey);

    const rowData = buildCardPayload(card, setId, uniqueNumber);
    const exactMatch = dbBySetAndNumber.get(`${setId}_${uniqueNumber.toUpperCase()}`);
    const unpadded = uniqueNumber.replace(/^0+/, '');
    const unpaddedMatch = !exactMatch ? dbBySetAndNumber.get(`${setId}_${unpadded.toUpperCase()}`) : null;
    const match = exactMatch || unpaddedMatch;

    if (match) {
      // Preserve existing R2 / local asset paths; fill/use official image URL otherwise
      const hasCustomR2 = match.image_path && !String(match.image_path).startsWith('http');
      const img = hasCustomR2 ? match.image_path : (rowData.image_path || match.image_path);
      toUpdate.push({ id: match.id, ...rowData, image_path: img });
    } else {
      toInsert.push(rowData);
    }
  }

  console.log('\nPlan Summary:');
  console.log(`  Existing DB rows      : ${existingDbCards.length}`);
  console.log(`  Matched to update     : ${toUpdate.length}`);
  console.log(`  New cards to insert   : ${toInsert.length}`);
  console.log(`  Total post-sync cards : ${toUpdate.length + toInsert.length}`);

  const maxGoof = [...toUpdate, ...toInsert].find((c) => c.metadata?.official_id === 3268);
  if (maxGoof) {
    console.log('\nVerified Max Goof (3268):', JSON.stringify(maxGoof, null, 2));
  }

  const sample = [...toUpdate.slice(0, 1), ...toInsert.slice(0, 1)];
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
