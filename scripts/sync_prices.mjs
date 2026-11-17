/**
 * Updates card prices in Supabase (cards and card_price_history) across supported games
 * (Riftbound, One Piece, Lorcana, MTG, Pokemon, Star Wars).
 *
 * Prices come strictly from Cardmarket's public price guide, in euros (src/lib/cardmarketPrices.ts).
 * The dotgg card API ties each card to its Cardmarket product id; cards not listed in Cardmarket's
 * price guide have no price (null) rather than pulling fallback prices from other marketplaces.
 *
 * Usage:
 *   node --experimental-strip-types scripts/sync_prices.mjs                  # Dry run
 *   node --experimental-strip-types scripts/sync_prices.mjs --apply          # Live run
 *   node --experimental-strip-types scripts/sync_prices.mjs --game=onepiece  # Single game
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { planCardmarketPrices, PRICE_GUIDE_URLS_BY_GAME, PRICE_GUIDE_URL } from '../src/lib/cardmarketPrices.ts';

const apply = process.argv.includes('--apply');
const gameArg = process.argv.find((a) => a.startsWith('--game='))?.split('=')[1]?.toLowerCase() || null;

const DOTGG_GAME_SLUGS = {
  riftbound: 'riftbound',
  onepiece: 'onepiece',
  lorcana: 'lorcana',
  mtg: 'magic',
  pokemon: 'pokemon',
  starwars: 'starwars',
};

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL || 'https://xtyfzkqubmzrsvduvzcl.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY in environment or .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function fetchExchangeRates() {
  try {
    const [usdEurRes, eurHufRes] = await Promise.all([
      fetch('https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR', { signal: AbortSignal.timeout(8000) }).then((r) => r.json()),
      fetch('https://api.frankfurter.dev/v1/latest?base=EUR&symbols=HUF', { signal: AbortSignal.timeout(8000) }).then((r) => r.json()),
    ]);
    return {
      usdEur: usdEurRes.rates.EUR,
      eurHuf: eurHufRes.rates.HUF,
      date: usdEurRes.date,
    };
  } catch (err) {
    console.warn('Failed to fetch live FX rate, using fallback 0.92:', err.message);
    return { usdEur: 0.92, eurHuf: 395, date: new Date().toISOString().slice(0, 10) };
  }
}

/** Cardmarket's price guide rows for a given game, or null if unavailable. */
async function fetchPriceGuide(game = 'riftbound') {
  const url = PRICE_GUIDE_URLS_BY_GAME[game] || PRICE_GUIDE_URL;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!Array.isArray(json.priceGuides) || json.priceGuides.length < 50) throw new Error('unexpected shape');
    return { rows: json.priceGuides, createdAt: json.createdAt || null };
  } catch (err) {
    console.warn(`Could not load the Cardmarket price guide for ${game} (${err.message}); using fallback prices.`);
    return null;
  }
}

const cents = (n) => (n === null || n === undefined ? null : Math.round(Number(n) * 100));

async function syncGame(game, cardsForGame) {
  const dotggGame = DOTGG_GAME_SLUGS[game] || game;
  console.log(`\n─── Syncing [${game}] (${cardsForGame.length} catalog cards) ───`);
  const apiRes = await fetch(`https://api.dotgg.gg/cgfw/getcards?game=${encodeURIComponent(dotggGame)}&mode=indexed`);
  if (!apiRes.ok) {
    if (game === 'riftbound') throw new Error(`Failed to fetch card prices from API for ${game}: HTTP ${apiRes.status}`);
    console.warn(`Skipping ${game}: API returned HTTP ${apiRes.status}`);
    return { final: [], changes: [], fromCardmarket: 0, fromFallback: 0, guideCreatedAt: null };
  }
  const dotgg = await apiRes.json();
  const names = dotgg.names || [];
  const idIdx = names.indexOf('id');
  const nameIdx = names.indexOf('name');
  const cmidIdx = names.indexOf('cmid');

  const missingColumns = Object.entries({ id: idIdx, name: nameIdx, cmid: cmidIdx }).filter(([, idx]) => idx < 0).map(([col]) => col);
  if (missingColumns.length > 0 || !Array.isArray(dotgg.data) || dotgg.data.length === 0) {
    if (game === 'riftbound') {
      throw new Error(`Price API response for ${game} is missing expected columns (${missingColumns.join(', ')}) or empty.`);
    }
    console.warn(`Skipping ${game}: unexpected API payload shape.`);
    return { final: [], changes: [], fromCardmarket: 0, cleared: 0, guideCreatedAt: null };
  }

  const links = dotgg.data.map((card) => ({
    id: card[idIdx] || '',
    name: card[nameIdx] || '',
    cmid: card[cmidIdx] ? Number(card[cmidIdx]) || null : null,
  }));

  const guide = await fetchPriceGuide(game);
  if (!guide) {
    console.warn(`Skipping [${game}]: Cardmarket price guide unavailable (no non-Cardmarket fallback used).`);
    return { final: [], changes: [], fromCardmarket: 0, cleared: 0, guideCreatedAt: null };
  }
  console.log(`Price guide (${game}): ${guide.rows.length} products (made ${guide.createdAt}).`);

  const cm = planCardmarketPrices(cardsForGame, links, guide.rows, game);

  if (game === 'riftbound' && cardsForGame.length > 0 && cm.prices.size / cardsForGame.length < 0.5) {
    throw new Error(
      `Only matched ${cm.prices.size}/${cardsForGame.length} Riftbound cards on Cardmarket - aborting.`
    );
  }

  const cardsById = new Map(cardsForGame.map((c) => [c.id, c]));
  const final = [];
  let cleared = 0;

  for (const [id, p] of cm.prices) {
    const card = cardsById.get(id);
    const eur = p.eur ?? null;
    const eurFoil = p.eurFoil ?? null;
    const moved = cents(eur) !== cents(card.market_price_eur) || cents(eurFoil) !== cents(card.market_price_foil_eur);
    final.push({ card, eur, eurFoil, source: 'cardmarket', moved });
  }

  // Clear stale non-Cardmarket prices on any card not listed in Cardmarket's guide
  for (const card of cardsForGame) {
    if (cm.prices.has(card.id)) continue;
    if (card.market_price_eur !== null || card.market_price_foil_eur !== null) {
      cleared += 1;
      final.push({ card, eur: null, eurFoil: null, source: 'cleared', moved: false });
    }
  }

  const fromCardmarket = cm.prices.size;
  const changes = final.filter((u) => u.moved);
  console.log(`[${game}] Cardmarket-only prices: ${fromCardmarket}/${cardsForGame.length} listed, ${cleared} non-Cardmarket cleared, ${changes.length} moved.`);

  return { final, changes, fromCardmarket, cleared, guideCreatedAt: guide.createdAt || null };
}

async function run() {
  console.log('Fetching exchange rates...');
  const rates = await fetchExchangeRates();
  console.log(`USD/EUR exchange rate: ${rates.usdEur} (${rates.date})`);

  const { data: fxRow } = await supabase.from('settings').select('value').eq('key', 'fx_rates').maybeSingle();
  let previousUsdEur = null;
  try {
    const parsed = JSON.parse(fxRow?.value || '{}');
    if (parsed.usd_eur && Number(parsed.usd_eur) > 0) {
      previousUsdEur = Number(parsed.usd_eur);
    }
  } catch {}

  console.log('Loading cards from Supabase...');
  const cards = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('cards')
      .select('id,game,name,card_number,rarity,image_path,market_price_eur,market_price_foil_eur')
      .range(from, from + 999);
    if (error) throw new Error(`Could not read cards from Supabase: ${error.message}`);
    cards.push(...data);
    if (data.length < 1000) break;
  }

  const gamesInDb = Array.from(new Set(cards.map((c) => c.game).filter(Boolean)));
  const targetGames = gameArg ? [gameArg] : gamesInDb.length > 0 ? gamesInDb : ['riftbound'];

  const allFinal = [];
  const allChanges = [];
  let totalCardmarket = 0;
  let totalFallback = 0;
  let latestGuideDate = null;

  for (const g of targetGames) {
    const subset = cards.filter((c) => c.game === g);
    if (subset.length === 0) continue;
    const res = await syncGame(g, subset);
    allFinal.push(...res.final);
    allChanges.push(...res.changes);
    totalCardmarket += res.fromCardmarket;
    totalFallback += res.cleared || 0;
    if (res.guideCreatedAt) latestGuideDate = res.guideCreatedAt;
  }

  if (allChanges.length > 0) {
    console.log('\nSample price changes:');
    allChanges.slice(0, 8).forEach((u) => {
      console.log(`  [${u.source}] ${u.card.name} (${u.card.card_number}): €${u.card.market_price_eur ?? '-'} -> €${u.eur ?? '-'} (foil: €${u.card.market_price_foil_eur ?? '-'} -> €${u.eurFoil ?? '-'})`);
    });
  }

  if (!apply) {
    console.log('\nDRY RUN complete. No changes were made to Supabase.');
    console.log('Run with --apply to write these price updates to the database.');
    return;
  }

  console.log('\nApplying price updates to Supabase via apply_price_import...');
  const rpcRows = allFinal.map((u) => ({
    id: u.card.id,
    eur: u.eur,
    eur_foil: u.eurFoil,
    moved: u.moved,
  }));

  const { data: rpcResult, error: rpcError } = await supabase.rpc('apply_price_import', {
    p_prices: rpcRows,
    p_recorded_at: new Date().toISOString(),
  });

  if (rpcError) {
    throw new Error(`Failed to apply prices: ${rpcError.message}`);
  }

  console.log(`Database update complete! Updated: ${rpcResult?.updated ?? allFinal.length} cards, Recorded in history: ${rpcResult?.recorded ?? allChanges.length}`);

  await supabase
    .from('settings')
    .upsert({ key: 'price_sources', value: JSON.stringify({ cardmarket: totalCardmarket, tcgplayer: 0, guide_created_at: latestGuideDate, synced_at: new Date().toISOString() }) }, { onConflict: 'key' });

  await supabase
    .from('settings')
    .upsert({ key: 'fx_rates', value: JSON.stringify({ usd_eur: rates.usdEur, eur_huf: rates.eurHuf, date: rates.date }) }, { onConflict: 'key' });

  console.log('Saved latest FX rates to settings.');
}

run().catch((err) => {
  console.error('Sync failed:', err);
  process.exit(1);
});
