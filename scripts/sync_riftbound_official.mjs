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
const shouldInsertNew = process.argv.includes('--insert-new');
const supabase = createClient(supabaseUrl, supabaseKey);

const OFFICIAL_RIFTBOUND_URL = 'https://playriftbound.com/en-us/card-gallery/';

// Official playriftbound.com set codes -> existing Supabase sets.code values
const OFFICIAL_TO_DB_SET_CODE = {
  OGN: 'OGN',
  SFD: 'SPI',
  UNL: 'UNL',
  VEN: 'VEN',
  RAD: 'RAD',
  OGS: 'PRO',
};

function htmlToPlainText(html) {
  return String(html || '')
    .replace(/<\/p>\s*<p>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

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

function mapOfficialCard(c, setId) {
  const cardType = c.cardType?.type?.[0]?.label || 'Unit';
  const rarity = c.rarity?.value?.label || 'Common';
  const domains = Array.isArray(c.domain?.values)
    ? c.domain.values.map((d) => d?.label).filter(Boolean).join(', ')
    : null;
  const artists = Array.isArray(c.illustrator?.values)
    ? c.illustrator.values.map((a) => a?.label).filter(Boolean).join(', ')
    : null;
  const energy = c.energy?.value?.id ?? (c.energy?.value?.label ? Number(c.energy.value.label) : null);
  const might = c.might?.value?.id ?? (c.might?.value?.label ? String(c.might.value.label) : null);
  const tags = Array.isArray(c.tags?.tags)
    ? c.tags.tags.map((t) => (typeof t === 'string' ? t : t?.label || t?.name)).filter(Boolean)
    : Array.isArray(c.tags)
    ? c.tags.map((t) => (typeof t === 'string' ? t : t?.label || t?.name)).filter(Boolean)
    : [];
  const text = htmlToPlainText(c.text?.richText?.body);

  return {
    set_id: setId,
    card_number: String(c.publicCode).trim(),
    name: String(c.name || '').trim(),
    rarity,
    card_type: cardType,
    cost: typeof energy === 'number' && !Number.isNaN(energy) ? energy : 0,
    energy: energy !== null && energy !== undefined ? String(energy) : null,
    might: might !== null && might !== undefined ? String(might) : null,
    domain: domains || null,
    tags: tags.length > 0 ? tags : null,
    text: text || null,
    artist: artists || null,
    image_path: c.cardImage?.url || null,
    game: 'riftbound',
    is_archived: false,
  };
}

async function main() {
  console.log(`Starting Riftbound official gallery sync${isDryRun ? ' [DRY RUN]' : ''}...`);
  console.log('Note: Existing DB cards absent from playriftbound.com are strictly preserved untouched.');

  const officialCards = await fetchOfficialRiftboundCards();
  console.log(`Loaded ${officialCards.length} official cards from playriftbound.com.`);

  const { data: existingSets } = await supabase
    .from('sets')
    .select('id, code, name')
    .eq('game', 'riftbound');

  const setByCode = new Map();
  for (const s of existingSets || []) {
    setByCode.set(String(s.code).toUpperCase(), s.id);
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
          .select('id, code')
          .single();
        if (!error && data) setByCode.set(dbCode, data.id);
      }
    }
  }

  const existingDbCards = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('cards')
      .select('id, set_id, card_number, image_path, name')
      .eq('game', 'riftbound')
      .range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    existingDbCards.push(...data);
    if (data.length < 1000) break;
  }

  const dbByCardNumber = new Map();
  for (const row of existingDbCards) {
    if (row.card_number) {
      dbByCardNumber.set(String(row.card_number).trim().toUpperCase(), row);
    }
  }

  const toUpdate = [];
  const toInsert = [];

  for (const oc of officialCards) {
    if (!oc.publicCode) continue;
    const offSetCode = String(oc.set?.value?.id || oc.publicCode.split('-')[0] || '').toUpperCase();
    const dbSetCode = OFFICIAL_TO_DB_SET_CODE[offSetCode] || offSetCode;
    const setId = setByCode.get(dbSetCode) || `DRY_${dbSetCode}`;

    const pubUpper = String(oc.publicCode).trim().toUpperCase();
    const existing = dbByCardNumber.get(pubUpper) || null;
    const mapped = mapOfficialCard(oc, existing?.set_id || setId);

    if (existing) {
      // Preserve custom/R2 image paths in Supabase
      const hasCustomR2 = existing.image_path && !String(existing.image_path).startsWith('http');
      const img = hasCustomR2 ? existing.image_path : (mapped.image_path || existing.image_path);
      toUpdate.push({ id: existing.id, ...mapped, image_path: img });
    } else {
      toInsert.push(mapped);
    }
  }

  const untouchedCount = existingDbCards.length - toUpdate.length;
  console.log('\nPlan Summary:');
  console.log(`  Existing DB rows               : ${existingDbCards.length}`);
  console.log(`  Official playriftbound matches : ${toUpdate.length}`);
  console.log(`  Existing DB-only (preserved)   : ${untouchedCount}`);
  console.log(`  New official cards to insert   : ${toInsert.length}`);
  console.log('\nSample payloads:');
  console.log(JSON.stringify([...toUpdate.slice(0, 1), ...toInsert.slice(0, 1)], null, 2));

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
        if (error) console.error(`Update failed ${fields.card_number}: ${error.message}`);
        else updated++;
      })
    );
  }

  let inserted = 0;
  if (shouldInsertNew && toInsert.length > 0) {
    const INSERT_BATCH = 100;
    for (let i = 0; i < toInsert.length; i += INSERT_BATCH) {
      const slice = toInsert.slice(i, i + INSERT_BATCH);
      const { error } = await supabase.from('cards').insert(slice);
      if (error) console.error(`Insert batch ${i} failed: ${error.message}`);
      else inserted += slice.length;
    }
  } else if (toInsert.length > 0) {
    console.log(`Skipping ${toInsert.length} unmatched official entries (pass --insert-new to insert them).`);
  }

  console.log(`\nDone. Updated=${updated}, Inserted=${inserted}, Preserved-untouched=${untouchedCount}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
