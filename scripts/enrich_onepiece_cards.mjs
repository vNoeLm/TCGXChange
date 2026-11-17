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

const BANDAI_URL = 'https://en.onepiece-cardgame.com/cardlist/';
const MODAL_ID_RE = /modalCol"\s+id="([^"]+)"/g;

function normalizeBaseCardNumber(raw) {
  if (!raw) return '';
  return String(raw)
    .trim()
    .toUpperCase()
    .replace(/\/.*$/, '')
    .replace(/(_P\d+|-P\d+|_R\d+|_[A-Z]+\d*)$/i, '')
    .replace(/\s+/g, '');
}

function decodeHtml(str) {
  return String(str || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&minus;/g, '−')
    .replace(/&nbsp;/g, ' ')
    .replace(/\r/g, '')
    .trim();
}

function extractSection(html, className) {
  const re = new RegExp(`<div class="${className}">([\\s\\S]*?)<\\/div>`, 'i');
  const m = html.match(re);
  return m ? m[1] : '';
}

function stripH3(sectionHtml) {
  return decodeHtml(String(sectionHtml || '').replace(/<h3>[\s\S]*?<\/h3>/gi, ''));
}

function parseBandaiModals(html) {
  const entries = [];
  const modalRe = /<dl class="modalCol" id="([^"]+)">([\s\S]*?)<\/dl>/gi;
  let m;
  while ((m = modalRe.exec(html)) !== null) {
    const modalId = m[1].trim().toUpperCase();
    const body = m[2];

    const infoSpans = [...(extractSection(body, 'infoCol').matchAll(/<span>([\s\S]*?)<\/span>/gi))].map((s) =>
      decodeHtml(s[1])
    );
    const cardNum = (infoSpans[0] || modalId.split('_')[0]).toUpperCase();
    const rarityCode = infoSpans[1] || '';
    const rawType = infoSpans[2] || '';

    const nameMatch = body.match(/<div class="cardName">([\s\S]*?)<\/div>/i);
    const name = nameMatch ? decodeHtml(nameMatch[1]) : '';

    const costRaw = stripH3(extractSection(body, 'cost'));
    const cost = /^\d+$/.test(costRaw) ? Number(costRaw) : null;

    const attrSection = extractSection(body, 'attribute');
    const attrItalics = [...attrSection.matchAll(/<i>([\s\S]*?)<\/i>/gi)]
      .map((a) => decodeHtml(a[1]))
      .filter((a) => a && a !== '-' && a !== '?');
    const attribute = attrItalics.length > 0 ? attrItalics.join('/') : null;

    const powerRaw = stripH3(extractSection(body, 'power'));
    const power = /^\d+$/.test(powerRaw) ? powerRaw : null;

    const counterRaw = stripH3(extractSection(body, 'counter'));
    const counter = /^\d+$/.test(counterRaw) ? Number(counterRaw) : null;

    const colorRaw = stripH3(extractSection(body, 'color'));
    const colors = colorRaw && colorRaw !== '-'
      ? colorRaw.split(/[/,]+/).map((c) => c.trim()).filter(Boolean)
      : [];

    const blockRaw = stripH3(extractSection(body, 'block'));
    const block_number = /^\d+$/.test(blockRaw) ? blockRaw : null;

    const typeRaw = stripH3(extractSection(body, 'feature'));
    const types = typeRaw && typeRaw !== '-'
      ? typeRaw.split('/').map((t) => t.trim()).filter(Boolean)
      : [];

    const effectRaw = stripH3(extractSection(body, 'text'));
    const effect = effectRaw && effectRaw !== '-' ? effectRaw : null;

    const triggerRaw = stripH3(extractSection(body, 'trigger'));
    const trigger = triggerRaw && triggerRaw !== '-' ? triggerRaw : null;

    const getInfoRaw = stripH3(extractSection(body, 'getInfo'));

    const imgMatch = body.match(/data-src="([^"]+)"/i);
    let imageUrl = null;
    if (imgMatch?.[1]) {
      imageUrl = new URL(imgMatch[1], BANDAI_URL).toString();
    }

    entries.push({
      id: modalId,
      card_number: cardNum,
      rarityCode,
      cardType: rawType,
      name,
      cost,
      attributes: attribute ? attribute.split('/') : [],
      attribute,
      power,
      counter,
      colors,
      block_number,
      types,
      effect,
      trigger,
      setText: getInfoRaw,
      imageUrl,
    });
  }
  return entries;
}

async function fetchBandaiSeriesList() {
  console.log(`Fetching series list from ${BANDAI_URL}...`);
  const res = await fetch(BANDAI_URL, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching Bandai cardlist`);
  const html = await res.text();
  const seriesIds = new Set();
  for (const m of html.matchAll(/<option[^>]*value="(\d+)"[^>]*>/gi)) {
    seriesIds.add(m[1]);
  }
  return Array.from(seriesIds);
}

async function fetchAllBandaiOfficialCards(seriesIds) {
  console.log(`Fetching official Bandai cards across ${seriesIds.length} series...`);
  const exactMap = new Map();
  const baseMap = new Map();
  const illustrationById = new Map();
  const reprintSet = new Set();

  const CONCURRENCY = 6;
  for (let i = 0; i < seriesIds.length; i += CONCURRENCY) {
    const slice = seriesIds.slice(i, i + CONCURRENCY);
    await Promise.all(
      slice.map(async (seriesId) => {
        try {
          const res = await fetch(BANDAI_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ series: seriesId }).toString(),
            signal: AbortSignal.timeout(20000),
          });
          if (!res.ok) return;
          const html = await res.text();
          const parsed = parseBandaiModals(html);
          for (const card of parsed) {
            card.seriesId = seriesId;
            if (!exactMap.has(card.id)) exactMap.set(card.id, card);
            const baseKey = normalizeBaseCardNumber(card.id);
            if (baseKey && (card.id === baseKey || !baseMap.has(baseKey))) {
              baseMap.set(baseKey, card);
            }
          }
        } catch (err) {
          console.warn(`Skipped series ${seriesId}: ${err.message}`);
        }
      })
    );
  }

  console.log(`Loaded ${exactMap.size} exact / ${baseMap.size} base official entries from Bandai.`);

  const postIds = async (params) => {
    try {
      const res = await fetch(BANDAI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params).toString(),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return [];
      const html = await res.text();
      return Array.from(html.matchAll(MODAL_ID_RE), (m) => m[1].trim().toUpperCase());
    } catch {
      return [];
    }
  };

  console.log('Fetching official Block X & Illustration Type filter flags...');
  const blockXSet = new Set();
  const [bxIds, comicIds, animIds, otherIds] = await Promise.all([
    postIds([['block_icon[]', 'X']]),
    postIds([['illustrations[]', 'Comic']]),
    postIds([['illustrations[]', 'Animation']]),
    postIds([['illustrations[]', 'Other']]),
  ]);
  bxIds.forEach((id) => blockXSet.add(id));
  comicIds.forEach((id) => illustrationById.set(id, 'Comic'));
  animIds.forEach((id) => illustrationById.set(id, 'Animation'));
  otherIds.forEach((id) => illustrationById.set(id, 'Other'));

  for (let i = 0; i < seriesIds.length; i += CONCURRENCY) {
    const slice = seriesIds.slice(i, i + CONCURRENCY);
    await Promise.all(
      slice.map(async (seriesId) => {
        const [origIds, allIds, nonReprintIds] = await Promise.all([
          postIds([['series', seriesId], ['illustrations[]', 'Original Illustrations']]),
          postIds([['series', seriesId]]),
          postIds([['series', seriesId], ['reprintsFlag', 'on']]),
        ]);
        origIds.forEach((id) => {
          if (!illustrationById.has(id)) illustrationById.set(id, 'Original Illustrations');
        });
        if (allIds.length > 0 && nonReprintIds.length > 0 && nonReprintIds.length < allIds.length) {
          const nonRp = new Set(nonReprintIds);
          for (const id of allIds) {
            if (!nonRp.has(id)) reprintSet.add(id);
          }
        }
      })
    );
  }

  console.log(`Official filters: Block X=${blockXSet.size}, Illustration=${illustrationById.size}, Reprints=${reprintSet.size}`);
  return { exactMap, baseMap, blockXSet, illustrationById, reprintSet };
}

async function fetchExistingOnePieceCards() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('cards')
      .select('id, card_number, name, card_type, rarity, domain, cost, might, subtype, text, effect, set_id, metadata')
      .eq('game', 'onepiece')
      .range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

function cleanNumericPower(val) {
  if (val === null || val === undefined) return null;
  const str = String(val).trim();
  return /^\d+$/.test(str) ? str : null;
}

function buildUpdatePayload(row, official, bandaiFlags) {
  const rawUpper = String(row.card_number || '').trim().toUpperCase();
  const baseKey = normalizeBaseCardNumber(rawUpper);
  const offKey = official?.id || null;

  const attribute = official?.attribute ?? null;
  const counter = official?.counter ?? null;

  let blockIcon = null;
  if (bandaiFlags.blockXSet.has(rawUpper) || (offKey && bandaiFlags.blockXSet.has(offKey)) || bandaiFlags.blockXSet.has(baseKey)) {
    blockIcon = 'X';
  } else if (official?.block_number) {
    blockIcon = String(official.block_number);
  }

  const illustrationType =
    bandaiFlags.illustrationById.get(rawUpper) ??
    (offKey ? bandaiFlags.illustrationById.get(offKey) : undefined) ??
    bandaiFlags.illustrationById.get(baseKey) ??
    null;

  const isReprint = Boolean(
    bandaiFlags.reprintSet.has(rawUpper) ||
    (offKey && bandaiFlags.reprintSet.has(offKey)) ||
    /_r\d+$/i.test(rawUpper) ||
    /\(reprint\)/i.test(row.name || '')
  );

  const cost = official?.cost !== null && official?.cost !== undefined ? official.cost : row.cost;
  const might = official?.power !== null && official?.power !== undefined ? official.power : cleanNumericPower(row.might);
  const subtype = official && official.types.length > 0 ? official.types.join('/') : row.subtype;
  const domain = official && official.colors.length > 0
    ? official.colors.join(' ')
    : (row.domain && row.domain !== 'Character' ? row.domain : null);
  const effect = official?.effect ?? row.effect ?? null;
  const rawTrigger = official?.trigger ?? null;

  const metadata = {
    ...(row.metadata && typeof row.metadata === 'object' ? row.metadata : {}),
    ...(attribute ? { attribute } : {}),
    ...(counter !== null ? { counter } : {}),
    ...(blockIcon !== null ? { block_icon: blockIcon } : {}),
    ...(illustrationType ? { illustration_type: illustrationType } : {}),
    ...(isReprint ? { is_reprint: true } : {}),
    ...(rawTrigger ? { trigger: rawTrigger } : {}),
    ...(official?.id ? { official_id: official.id } : {}),
  };

  return {
    attribute,
    counter,
    block_icon: blockIcon,
    illustration_type: illustrationType,
    is_reprint: isReprint,
    cost,
    might,
    subtype,
    domain,
    effect,
    metadata,
  };
}

async function main() {
  console.log(`Starting official Bandai One Piece enrichment${isDryRun ? ' [DRY RUN]' : ''}...`);

  const { error: schemaError } = await supabase
    .from('cards')
    .select('id, metadata, attribute, counter, block_icon, illustration_type, is_reprint')
    .eq('game', 'onepiece')
    .limit(1);

  if (schemaError) {
    console.warn(`Schema check warning (${schemaError.code}): ${schemaError.message}`);
    if (!isDryRun) {
      console.error('\nRun supabase/migrations/20261117000000_onepiece_card_fields.sql in Supabase SQL Editor first.');
      process.exit(1);
    }
  }

  const seriesIds = await fetchBandaiSeriesList();
  const [bandaiData, existingRows] = await Promise.all([
    fetchAllBandaiOfficialCards(seriesIds),
    fetchExistingOnePieceCards(),
  ]);

  console.log(`Fetched ${existingRows.length} existing One Piece cards from Supabase.`);

  let matchedExact = 0;
  let matchedBase = 0;
  let unmatched = 0;
  const samples = [];
  const updates = [];

  for (const row of existingRows) {
    const rawUpper = String(row.card_number || '').trim().toUpperCase();
    const baseKey = normalizeBaseCardNumber(rawUpper);

    let official = bandaiData.exactMap.get(rawUpper) || null;
    if (official) {
      matchedExact++;
    } else {
      official = bandaiData.baseMap.get(baseKey) || null;
      if (official) matchedBase++;
      else unmatched++;
    }

    const payload = buildUpdatePayload(row, official, bandaiData);
    updates.push({ id: row.id, card_number: row.card_number, name: row.name, payload });
    if (samples.length < 5 && (payload.attribute || payload.counter !== null || payload.block_icon !== null)) {
      samples.push({ card_number: row.card_number, name: row.name, ...payload });
    }
  }

  console.log('\nMatch Summary:');
  console.log(`  Total DB rows        : ${existingRows.length}`);
  console.log(`  Bandai official exact: ${matchedExact}`);
  console.log(`  Bandai official base : ${matchedBase}`);
  console.log(`  Unmatched (kept)     : ${unmatched}`);
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
        const { error } = await supabase.from('cards').update(item.payload).eq('id', item.id);
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
