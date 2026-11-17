const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL || 'https://xtyfzkqubmzrsvduvzcl.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function batchUpdateCards(updates) {
  const CHUNK_SIZE = 50;
  let done = 0;
  for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
    const chunk = updates.slice(i, i + CHUNK_SIZE);
    await Promise.all(chunk.map(u => 
      supabase.from('cards').update({
        market_price_eur: u.normal,
        market_price_foil_eur: u.foil,
        last_price_updated_at: new Date().toISOString()
      }).eq('id', u.id)
    ));
    done += chunk.length;
    if (done % 500 === 0 || done === updates.length) {
      process.stdout.write(`Updated ${done}/${updates.length}...\r`);
    }
  }
  console.log(`\nFinished updating ${updates.length} cards.`);
}

async function fetchExchangeRate() {
  try {
    const res = await fetch('https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR').then(r => r.json());
    return res.rates.EUR || 0.92;
  } catch (e) {
    return 0.92;
  }
}

async function syncLorcana() {
  console.log('Syncing Disney Lorcana prices from Cardmarket...');
  const [lorcanaJson, priceGuide] = await Promise.all([
    fetch('https://lorcanajson.org/files/current/en/allCards.json').then(r => r.json()),
    fetch('https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_19.json').then(r => r.json())
  ]);

  const priceMap = new Map();
  for (const p of priceGuide.priceGuides) {
    const normal = p.trend || p.avg30 || p.avg || null;
    const foil = p['trend-foil'] || p['avg30-foil'] || p['avg-foil'] || null;
    priceMap.set(p.idProduct, {
      normal: normal ? Math.round(Number(normal) * 100) / 100 : null,
      foil: foil ? Math.round(Number(foil) * 100) / 100 : null,
    });
  }

  // Map by Lorcana card fullName
  const priceByName = new Map();
  for (const c of lorcanaJson.cards) {
    const cmid = c.externalLinks && c.externalLinks.cardmarketId;
    if (cmid && priceMap.has(cmid)) {
      const p = priceMap.get(cmid);
      priceByName.set(c.fullName.toLowerCase().trim(), p);
    }
  }

  // Load all lorcana cards from DB
  let allCards = [];
  let page = 0;
  while (true) {
    const { data, error } = await supabase.from('cards').select('id, card_number, name').eq('game', 'lorcana').range(page * 1000, (page + 1) * 1000 - 1);
    if (error || !data || data.length === 0) break;
    allCards.push(...data);
    if (data.length < 1000) break;
    page++;
  }
  console.log(`Found ${allCards.length} Lorcana cards in DB.`);

  const updates = [];
  for (const card of allCards) {
    const prices = priceByName.get(card.name.toLowerCase().trim());
    if (prices && (prices.normal !== null || prices.foil !== null)) {
      updates.push({ id: card.id, normal: prices.normal, foil: prices.foil });
    }
  }
  await batchUpdateCards(updates);
}

async function syncStarWars() {
  console.log('Skipping Star Wars SWU-DB sync (Cardmarket-only pricing policy; use Cardmarket guide).');
}

async function syncFab() {
  console.log('Syncing Flesh and Blood prices from Cardmarket...');
  const [productsJson, priceGuide] = await Promise.all([
    fetch('https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_16.json').then(r => r.json()),
    fetch('https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_16.json').then(r => r.json())
  ]);

  const priceMap = new Map();
  for (const p of priceGuide.priceGuides) {
    const normal = p.trend || p.avg30 || p.avg || null;
    const foil = p['trend-foil'] || p['avg30-foil'] || p['avg-foil'] || null;
    priceMap.set(p.idProduct, {
      normal: normal ? Math.round(Number(normal) * 100) / 100 : null,
      foil: foil ? Math.round(Number(foil) * 100) / 100 : null,
    });
  }

  const cmByName = new Map();
  for (const prod of productsJson.products) {
    const key = prod.name.toLowerCase().trim();
    if (!cmByName.has(key)) cmByName.set(key, prod.idProduct);
  }

  let allCards = [];
  let page = 0;
  while (true) {
    const { data, error } = await supabase.from('cards').select('id, name').eq('game', 'fab').range(page * 1000, (page + 1) * 1000 - 1);
    if (error || !data || data.length === 0) break;
    allCards.push(...data);
    if (data.length < 1000) break;
    page++;
  }
  console.log(`Found ${allCards.length} Flesh and Blood cards in DB.`);

  const updates = [];
  for (const card of allCards) {
    const key = card.name.toLowerCase().trim();
    const pid = cmByName.get(key);
    if (pid && priceMap.has(pid)) {
      const prices = priceMap.get(pid);
      if (prices && (prices.normal !== null || prices.foil !== null)) {
        updates.push({ id: card.id, normal: prices.normal, foil: prices.foil });
      }
    }
  }
  await batchUpdateCards(updates);
}

async function main() {
  await syncLorcana();
  await syncStarWars();
  await syncFab();
  console.log('Finished updating Cardmarket market prices for new games!');
}

main();
