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

const CARDVAULT_API = 'https://api.cardvault.fabtcg.com/carddb/api/v1';

const RARITY_TITLE = {
  common: 'Common',
  rare: 'Rare',
  'super-rare': 'Super Rare',
  'super rare': 'Super Rare',
  majestic: 'Majestic',
  legendary: 'Legendary',
  fabled: 'Fabled',
  marvel: 'Marvel',
  promo: 'Promo',
  token: 'Token',
};

const KNOWN_TYPES_PRIORITY = [
  'Hero',
  'Weapon',
  'Equipment',
  'Demi-Hero',
  'Action',
  'Attack Reaction',
  'Defense Reaction',
  'Instant',
  'Resource',
  'Mentor',
  'Block',
  'Macro',
  'Token',
];

async function fetchJsonWithRetry(url, retries = 4) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'TCGXChange-Sync/1.0' },
        signal: AbortSignal.timeout(15000),
      });
      if (res.status === 429) {
        const wait = 1500 * attempt;
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} (${url})`);
      return await res.json();
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
}

function cleanSetNumber(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/-(RF|CF|EA|MV|GF|FA|AA|F)$/i, '');
}

function extractSetPrefix(setNumber) {
  const m = String(setNumber || '').trim().toUpperCase().match(/^([A-Z0-9]{2,5}?)\d/);
  return m ? m[1] : null;
}

function formatTextbox(raw) {
  return String(raw || '')
    .replace(/\{br\}/gi, '\n')
    .trim();
}

function titleCaseLegality(val) {
  const clean = String(val || '').trim().toLowerCase();
  if (!clean || clean === 'not legal') return 'Not legal';
  if (clean === 'legal') return 'Legal';
  return clean.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

async function main() {
  console.log(`Starting Flesh and Blood official CardVault sync${isDryRun ? ' [DRY RUN]' : ''}...`);

  // 1. Fetch product groups
  const groupsRes = await fetchJsonWithRetry(`${CARDVAULT_API}/product-groups-products/?page_size=250`);
  const groups = groupsRes.results || [];
  console.log(`Loaded ${groups.length} official product groups from CardVault.`);

  // Collect English products
  const enProducts = [];
  for (const g of groups) {
    const enProd =
      (g.products || []).find((p) => p.printed_language === 'en' && !String(p.slug || '').endsWith('-ja')) ||
      (g.products || []).find((p) => p.slug === g.slug);
    if (!enProd?.slug) continue;
    enProducts.push({
      groupName: g.group_name,
      productType: g.product_type,
      releaseDate: enProd.release_date || g.release_date || null,
      slug: enProd.slug,
      productName: enProd.product_name || g.group_name,
    });
  }
  console.log(`Found ${enProducts.length} English CardVault products.`);

  // 2. Fetch product-cards for each EN product
  const cardsByCardId = new Map();
  const productSetHints = new Map();
  const CONC_PROD = 8;
  for (let i = 0; i < enProducts.length; i += CONC_PROD) {
    const slice = enProducts.slice(i, i + CONC_PROD);
    await Promise.all(
      slice.map(async (prod) => {
        try {
          const pc = await fetchJsonWithRetry(`${CARDVAULT_API}/product-cards/${prod.slug}/`);
          const list = Array.isArray(pc.cards) ? pc.cards : [];
          for (const c of list) {
            if (!c?.card_id) continue;
            const cleanNum = cleanSetNumber(c.print_id);
            const prefix = extractSetPrefix(cleanNum);
            if (prefix && !productSetHints.has(prefix)) {
              productSetHints.set(prefix, {
                name: prod.groupName,
                releaseDate: prod.releaseDate || pc.release_date || null,
              });
            }
            if (!cardsByCardId.has(c.card_id)) {
              cardsByCardId.set(c.card_id, { summary: c, products: new Set([prod.slug]) });
            } else {
              cardsByCardId.get(c.card_id).products.add(prod.slug);
            }
          }
        } catch (err) {
          console.warn(`Skipped product ${prod.slug}: ${err.message}`);
        }
      })
    );
  }

  const uniqueCardIds = Array.from(cardsByCardId.keys());
  console.log(`Collected ${uniqueCardIds.length} unique card_ids across ${productSetHints.size} set prefixes.`);

  // 3. Fetch full card details from card_id endpoint
  const detailByCardId = new Map();
  const CONC_CARD = 6;
  for (let i = 0; i < uniqueCardIds.length; i += CONC_CARD) {
    const slice = uniqueCardIds.slice(i, i + CONC_CARD);
    await Promise.all(
      slice.map(async (cid) => {
        try {
          const res = await fetchJsonWithRetry(`${CARDVAULT_API}/card_id/${encodeURIComponent(cid)}/`);
          const detail = res.results?.[0];
          if (detail) detailByCardId.set(cid, detail);
        } catch (err) {
          console.warn(`Skipped card_id ${cid}: ${err.message}`);
        }
      })
    );
    const done = Math.min(i + CONC_CARD, uniqueCardIds.length);
    if (done % 300 < CONC_CARD || done === uniqueCardIds.length) {
      console.log(`  fetched details: ${done}/${uniqueCardIds.length}`);
    }
  }

  // Load existing sets & cards from DB
  const { data: existingSets } = await supabase
    .from('sets')
    .select('id, code, name, release_date')
    .eq('game', 'fab');

  const setByCode = new Map();
  for (const s of existingSets || []) {
    setByCode.set(String(s.code).toUpperCase(), s);
  }

  // Upsert sets cleanly for all discovered prefixes
  for (const [prefix, hint] of productSetHints.entries()) {
    const dbCode = `FAB-${prefix}`;
    if (!setByCode.has(dbCode) && !isDryRun) {
      const { data, error } = await supabase
        .from('sets')
        .upsert(
          { code: dbCode, name: hint.name, game: 'fab', release_date: hint.releaseDate },
          { onConflict: 'code' }
        )
        .select('id, code, name, release_date')
        .single();
      if (!error && data) setByCode.set(dbCode, data);
    }
  }

  const existingDbCards = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('cards')
      .select('id, set_id, card_number, name, image_path')
      .eq('game', 'fab')
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

  // Build canonical per-(setCode, cardNumber) entries from all fetched EN printings
  const seenSetNum = new Set();
  const toUpdate = [];
  const toInsert = [];

  for (const detail of detailByCardId.values()) {
    const core = detail.cores?.[0];
    if (!core) continue;

    const classes = (core.core_classes || []).map((c) => c.name_en || c.name).filter(Boolean);
    const talents = (core.core_talents || []).map((t) => t.name_en || t.name).filter(Boolean);
    const types = (core.core_types || []).map((t) => t.name_en || t.name).filter(Boolean);
    const subtypes = (core.core_subtypes || []).map((s) => s.name_en || s.name).filter(Boolean);

    const primaryType =
      KNOWN_TYPES_PRIORITY.find((t) => types.includes(t)) || types[types.length - 1] || 'Action';
    const domain = classes.length > 0 ? classes.join(', ') : talents.length > 0 ? talents.join(', ') : 'Generic';

    const legalityObj = {};
    for (const [fmt, obj] of Object.entries(detail.card_legality || {})) {
      legalityObj[fmt] = titleCaseLegality(obj?.legality);
    }
    const legalFormats = Object.entries(legalityObj)
      .filter(([, status]) => status === 'Legal')
      .map(([fmt]) => fmt);

    const pitchVal = core.pitch_value ?? (core.pitch ? Number(core.pitch) : null);
    const pitchSuffix =
      pitchVal === 1 ? ' (Red)' : pitchVal === 2 ? ' (Yellow)' : pitchVal === 3 ? ' (Blue)' : '';
    const displayName = `${core.name}${pitchSuffix}`.slice(0, 150);

    const functionalText = formatTextbox(core.textbox);

    // Process each English printing of this card
    const enPrints = (detail.card_prints || []).filter((p) => {
      const lang = (p.print_language || '').toLowerCase();
      return lang === 'en' || p.faces?.some((f) => f.face_language === 'en');
    });

    for (const pr of enPrints) {
      const cardNumber = cleanSetNumber(pr.set_number || pr.print_id);
      const prefix = extractSetPrefix(cardNumber);
      if (!cardNumber || !prefix) continue;

      const dbSetCode = `FAB-${prefix}`;
      const setId = setByCode.get(dbSetCode)?.id || `DRY_${dbSetCode}`;
      const dedupeKey = `${dbSetCode}_${cardNumber}`;
      if (seenSetNum.has(dedupeKey)) continue;
      seenSetNum.add(dedupeKey);

      const face = pr.faces?.find((f) => f.face_language === 'en') || pr.faces?.[0];
      const imageUrl = face?.image?.large || face?.image?.normal || null;
      const artist = face?.printed_artist || null;
      const rarityRaw = String(pr.rarity || '').trim().toLowerCase();
      const rarity = RARITY_TITLE[rarityRaw] || (rarityRaw ? rarityRaw.charAt(0).toUpperCase() + rarityRaw.slice(1) : 'Common');

      const costVal = core.cost_value !== null && core.cost_value !== undefined ? Number(core.cost_value) : 0;
      const powerVal = core.power_value !== null && core.power_value !== undefined ? String(core.power_value) : null;
      const defenseVal = core.defense_value !== null && core.defense_value !== undefined ? Number(core.defense_value) : null;
      const intellectVal = core.intellect_value !== null && core.intellect_value !== undefined ? Number(core.intellect_value) : null;
      const lifeVal = core.life_value !== null && core.life_value !== undefined ? Number(core.life_value) : null;

      const metadata = {
        official_id: detail.card_id,
        pitch: pitchVal,
        color: core.color || null,
        classes,
        talents,
        types,
        subtypes,
        typebox: core.typebox || null,
        attack: core.power_value ?? null,
        defense: defenseVal,
        intellect: intellectVal,
        life: lifeVal,
        legality: legalityObj,
        legal_formats: legalFormats,
      };

      const rowPayload = {
        set_id: setId,
        card_number: cardNumber,
        name: displayName,
        rarity,
        card_type: primaryType,
        cost: Number.isFinite(costVal) ? costVal : 0,
        energy: pitchVal !== null && pitchVal !== undefined ? String(pitchVal) : null,
        might: powerVal,
        might_bonus: defenseVal,
        domain,
        subtype: core.typebox || [...talents, ...classes, ...types, ...subtypes].join(' '),
        tags: [...talents, ...classes, ...subtypes],
        text: functionalText || null,
        artist,
        image_path: imageUrl,
        game: 'fab',
        is_archived: false,
        metadata,
      };

      const existing = dbBySetAndNumber.get(`${setId}_${cardNumber}`);
      if (existing) {
        const hasCustomR2 = existing.image_path && !String(existing.image_path).startsWith('http');
        const img = hasCustomR2 ? existing.image_path : (imageUrl || existing.image_path);
        toUpdate.push({ id: existing.id, ...rowPayload, image_path: img });
      } else {
        toInsert.push(rowPayload);
      }
    }
  }

  console.log('\nPlan Summary:');
  console.log(`  Existing DB rows      : ${existingDbCards.length}`);
  console.log(`  Matched to update     : ${toUpdate.length}`);
  console.log(`  New cards to insert   : ${toInsert.length}`);

  const virulent = [...toUpdate, ...toInsert].find((c) => c.card_number === 'OBK003');
  if (virulent) {
    console.log('\nVerified OBK003 (Virulent Cascade):', JSON.stringify(virulent, null, 2));
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
        if (error) console.error(`Update failed ${fields.card_number}: ${error.message}`);
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
