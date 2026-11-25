/**
 * Downloads external card images (http/https), compresses them to optimized WebP
 * + generates responsive thumbnails (thumbs/v1/{240,360,480}), uploads all to
 * Cloudflare R2, and rewrites cards.image_path in Supabase to the clean relative R2 path.
 *
 * Also mirrors Star Wars: Unlimited double-sided `metadata.art_back` URLs when present.
 *
 * Usage:
 *   node scripts/ingest_cards_to_r2.mjs --dry-run
 *   node scripts/ingest_cards_to_r2.mjs --game riftbound
 *   node scripts/ingest_cards_to_r2.mjs --game starwars --concurrency 10
 *   node scripts/ingest_cards_to_r2.mjs --game all
 *   node scripts/ingest_cards_to_r2.mjs --game lorcana --limit 50
 */
import 'dotenv/config';
import sharp from 'sharp';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';

const ACTIVE_GAMES = ['riftbound', 'onepiece', 'lorcana', 'starwars', 'fab'];
const THUMB_VERSION = 'v1';
const THUMB_WIDTHS = [240, 360, 480];
const MAIN_MAX_WIDTH = 745;
const MAIN_MAX_HEIGHT = 1040;
const MAIN_WEBP_QUALITY = 78;
const THUMB_WEBP_QUALITY = 72;
const CARD_HEIGHT_PER_WIDTH = 88 / 63;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const gameIdx = args.indexOf('--game');
const gameArg = (gameIdx !== -1 ? args[gameIdx + 1] : 'all')?.toLowerCase() || 'all';
const limitIdx = args.indexOf('--limit');
const limit = limitIdx !== -1 ? Number(args[limitIdx + 1]) : Infinity;
const concIdx = args.indexOf('--concurrency');
const concurrency = concIdx !== -1 ? Math.max(1, Math.min(32, Number(args[concIdx + 1]) || 8)) : 8;

const targetGames = gameArg === 'all' ? ACTIVE_GAMES : gameArg.split(',').map((g) => g.trim()).filter(Boolean);

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucketName = process.env.R2_BUCKET_NAME || 'tcg-cards';

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

if (!dryRun && (!accountId || !accessKeyId || !secretAccessKey)) {
  console.error('Missing R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, or R2_SECRET_ACCESS_KEY in .env');
  console.error('Add them to .env (or run with --dry-run to inspect pending counts).');
  process.exit(1);
}

const r2 = !dryRun
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    })
  : null;

const supabase = createClient(supabaseUrl, supabaseKey);

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

async function existsInR2(key) {
  if (!r2) return false;
  try {
    await r2.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function uploadWebp(key, buffer) {
  await r2.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: buffer,
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable',
    })
  );
}

async function fetchImageWithRetry(url, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(15000),
        headers: {
          'User-Agent': 'TCGXChange-ImageIngest/1.0',
          Accept: 'image/webp,image/avif,image/png,image/jpeg,image/*,*/*;q=0.8',
        },
      });
      if (res.ok) {
        return Buffer.from(await res.arrayBuffer());
      }
      if (res.status === 404 || res.status === 410) {
        throw new Error(`HTTP ${res.status}`);
      }
      if (attempt === maxRetries) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (attempt === maxRetries) throw err;
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
  throw new Error('Download failed');
}

function buildR2Key(game, setCode, cardNumber, id, suffix = '') {
  const safeSet = String(setCode || '').replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
  const safeNum = String(cardNumber || id.slice(0, 8))
    .replace(/\//g, '-')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  const prefix = safeSet && !safeNum.toLowerCase().startsWith(safeSet) ? `${safeSet}-` : '';
  return `${game}/${prefix}${safeNum}${suffix}.webp`;
}

async function optimizeAndUpload(sourceUrl, r2Key) {
  const alreadyMain = !force && (await existsInR2(r2Key));
  if (alreadyMain) {
    return { skipped: true, rawBytes: 0, uploadedBytes: 0 };
  }

  const rawBuffer = await fetchImageWithRetry(sourceUrl);
  const meta = await sharp(rawBuffer).metadata();
  const landscape = (meta.width || 0) > (meta.height || 0);

  const mainResize = landscape
    ? { width: MAIN_MAX_HEIGHT, height: MAIN_MAX_WIDTH, fit: 'inside', withoutEnlargement: true }
    : { width: MAIN_MAX_WIDTH, height: MAIN_MAX_HEIGHT, fit: 'inside', withoutEnlargement: true };

  const [mainWebp, ...thumbBuffers] = await Promise.all([
    sharp(rawBuffer)
      .resize(mainResize)
      .webp({ quality: MAIN_WEBP_QUALITY, effort: 5, smartSubsample: true })
      .toBuffer(),
    ...THUMB_WIDTHS.map((width) => {
      const resize = landscape
        ? { height: Math.round(width * CARD_HEIGHT_PER_WIDTH), withoutEnlargement: true }
        : { width, withoutEnlargement: true };
      return sharp(rawBuffer)
        .resize(resize)
        .webp({ quality: THUMB_WEBP_QUALITY, effort: 5, smartSubsample: true })
        .toBuffer();
    }),
  ]);

  await Promise.all([
    uploadWebp(r2Key, mainWebp),
    ...THUMB_WIDTHS.map((width, idx) =>
      uploadWebp(`thumbs/${THUMB_VERSION}/${width}/${r2Key}`, thumbBuffers[idx])
    ),
  ]);

  const uploadedBytes = mainWebp.length + thumbBuffers.reduce((sum, b) => sum + b.length, 0);
  return { skipped: false, rawBytes: rawBuffer.length, uploadedBytes };
}

async function fetchExternalCardsForGame(game) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('cards')
      .select('id, game, card_number, image_path, metadata, sets ( code )')
      .eq('game', game)
      .like('image_path', 'http%')
      .range(from, from + 999);
    if (error) throw new Error(`Query failed for ${game}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

async function main() {
  console.log(`Target games: ${targetGames.join(', ')} | dryRun=${dryRun} | concurrency=${concurrency} | limit=${limit}`);

  let allPending = [];
  for (const g of targetGames) {
    const list = await fetchExternalCardsForGame(g);
    console.log(`  ${g}: ${list.length} cards still pointing to external http(s) URLs`);
    allPending.push(...list);
  }

  if (allPending.length === 0) {
    console.log('All target cards are already hosted on Cloudflare R2!');
    return;
  }

  const queue = allPending.slice(0, limit);
  if (dryRun) {
    console.log(`\nDry run complete. Would ingest & optimize ${queue.length} cards to R2 (${bucketName}).`);
    return;
  }

  console.log(`\nStarting ingestion of ${queue.length} cards into R2 bucket "${bucketName}"...`);

  let processed = 0;
  let succeeded = 0;
  let skipped = 0;
  let totalRaw = 0;
  let totalUploaded = 0;
  const failures = [];

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (queue.length > 0) {
        const card = queue.shift();
        const setCode = Array.isArray(card.sets) ? card.sets[0]?.code : card.sets?.code;
        const r2Key = buildR2Key(card.game, setCode, card.card_number, card.id);

        try {
          const res = await optimizeAndUpload(card.image_path, r2Key);
          totalRaw += res.rawBytes;
          totalUploaded += res.uploadedBytes;
          if (res.skipped) skipped += 1;

          const updatePayload = { image_path: r2Key };

          // Mirror Star Wars double-sided art_back if still external
          const backUrl = card.metadata?.art_back;
          if (typeof backUrl === 'string' && /^https?:\/\//i.test(backUrl)) {
            try {
              const backKey = buildR2Key(card.game, setCode, card.card_number, card.id, '-back');
              const backRes = await optimizeAndUpload(backUrl, backKey);
              totalRaw += backRes.rawBytes;
              totalUploaded += backRes.uploadedBytes;
              updatePayload.metadata = { ...(card.metadata || {}), art_back: backKey };
            } catch (backErr) {
              // Non-fatal: still save main front R2 path
              failures.push(`${card.game}/${card.card_number} (back): ${backErr.message}`);
            }
          }

          const { error: dbErr } = await supabase.from('cards').update(updatePayload).eq('id', card.id);
          if (dbErr) throw new Error(`DB update failed: ${dbErr.message}`);
          succeeded += 1;
        } catch (err) {
          failures.push(`${card.game}/${card.card_number}: ${err.message}`);
        } finally {
          processed += 1;
          if (processed % 10 === 0 || processed === allPending.length || queue.length === 0) {
            process.stdout.write(
              `\r  Progress: ${processed} done (${succeeded} ok, ${skipped} cached, ${failures.length} err) | Source ${mb(totalRaw)} -> R2 ${mb(totalUploaded)}   `
            );
          }
        }
      }
    })
  );

  console.log(`\n\nFinished! Succeeded: ${succeeded}, Skipped (already in R2): ${skipped}, Failed: ${failures.length}`);
  console.log(`Total downloaded: ${mb(totalRaw)} -> Uploaded WebP (main + 3 thumbs): ${mb(totalUploaded)}`);
  if (failures.length > 0) {
    console.log('\nFirst 20 failures:');
    failures.slice(0, 20).forEach((f) => console.log(`  - ${f}`));
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
