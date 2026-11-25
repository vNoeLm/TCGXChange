/**
 * Migrates existing app/user uploads (avatars, banners, custom-cards, marketplace, showcase)
 * from Supabase Storage bucket "card-images" to Cloudflare R2 bucket "tcg-cards",
 * and rewrites stored URLs in Supabase tables to the R2 CDN URL.
 *
 * Usage:
 *   node scripts/migrate_supabase_uploads_to_r2.mjs                # dry run
 *   node scripts/migrate_supabase_uploads_to_r2.mjs --apply        # copy to R2 + rewrite DB URLs
 *   node scripts/migrate_supabase_uploads_to_r2.mjs --apply --delete-source  # also remove from Supabase Storage
 */
import 'dotenv/config';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';

const FOLDERS = ['avatars', 'banners', 'custom-cards', 'marketplace', 'showcase'];
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const deleteSource = args.includes('--delete-source');

const supabaseUrl = (process.env.PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucketName = process.env.R2_BUCKET_NAME || 'tcg-cards';
const cdnUrl = (process.env.PUBLIC_IMAGE_CDN_URL || 'https://pub-fc12cf26538b49798ca89e43c2bf3c4a.r2.dev').replace(/\/+$/, '');

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}
if (apply && (!accountId || !accessKeyId || !secretAccessKey)) {
  console.error('Missing R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, or R2_SECRET_ACCESS_KEY in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const r2 = apply
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    })
  : null;

const SUPA_PREFIX = `${supabaseUrl}/storage/v1/object/public/card-images/`;

async function listRecursive(prefix) {
  const results = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await supabase.storage.from('card-images').list(prefix, { limit: 100, offset });
    if (error || !data?.length) break;
    for (const item of data) {
      const fullPath = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) {
        const nested = await listRecursive(fullPath);
        results.push(...nested);
      } else {
        results.push({ path: fullPath, mime: item.metadata?.mimetype || 'image/webp' });
      }
    }
    if (data.length < 100) break;
  }
  return results;
}

async function existsInR2(key) {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }));
    return true;
  } catch {
    return false;
  }
}

function rewriteUrl(val) {
  if (typeof val !== 'string') return val;
  if (val.startsWith(SUPA_PREFIX)) {
    return `${cdnUrl}/${val.slice(SUPA_PREFIX.length)}`;
  }
  return val;
}

async function main() {
  const allFiles = [];
  for (const folder of FOLDERS) {
    const files = await listRecursive(folder);
    console.log(`  Supabase card-images/${folder}: ${files.length} files`);
    allFiles.push(...files);
  }

  console.log(`Total Supabase upload files found: ${allFiles.length}`);
  if (!apply) {
    console.log('\nDry run complete. Run with --apply to copy files to R2 and update DB URLs.');
    return;
  }

  let copied = 0;
  let skipped = 0;
  for (const f of allFiles) {
    if (await existsInR2(f.path)) {
      skipped += 1;
      continue;
    }
    const res = await fetch(`${SUPA_PREFIX}${f.path}`);
    if (!res.ok) {
      console.warn(`  Skip failed download (${res.status}): ${f.path}`);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') || f.mime || 'image/webp';
    const cacheControl = f.path.startsWith('avatars/') || f.path.startsWith('banners/')
      ? 'public, max-age=3600'
      : 'public, max-age=31536000, immutable';
    await r2.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: f.path,
        Body: buf,
        ContentType: contentType,
        CacheControl: cacheControl,
      })
    );
    copied += 1;
  }
  console.log(`R2 sync complete: ${copied} copied, ${skipped} already existed.`);

  // Rewrite URLs in profiles.avatar_url
  const { data: profiles } = await supabase.from('profiles').select('id, avatar_url').like('avatar_url', `${SUPA_PREFIX}%`);
  for (const p of profiles || []) {
    await supabase.from('profiles').update({ avatar_url: rewriteUrl(p.avatar_url) }).eq('id', p.id);
  }
  console.log(`Updated ${(profiles || []).length} profile avatar URLs.`);

  // Rewrite URLs in cards.image_path
  const { data: cards } = await supabase.from('cards').select('id, image_path').like('image_path', `${SUPA_PREFIX}%`);
  for (const c of cards || []) {
    const relKey = c.image_path.slice(SUPA_PREFIX.length);
    await supabase.from('cards').update({ image_path: relKey }).eq('id', c.id);
  }
  console.log(`Updated ${(cards || []).length} custom card image paths.`);

  // Rewrite URLs in store_products.images
  const { data: storeProds } = await supabase.from('store_products').select('id, images').not('images', 'is', null);
  let storeUpdated = 0;
  for (const sp of storeProds || []) {
    if (!Array.isArray(sp.images)) continue;
    const next = sp.images.map(rewriteUrl);
    if (JSON.stringify(next) !== JSON.stringify(sp.images)) {
      await supabase.from('store_products').update({ images: next }).eq('id', sp.id);
      storeUpdated += 1;
    }
  }
  console.log(`Updated ${storeUpdated} store product image arrays.`);

  // Rewrite URLs in marketplace_listings.images
  const { data: listings } = await supabase.from('marketplace_listings').select('id, images').not('images', 'is', null);
  let listingsUpdated = 0;
  for (const l of listings || []) {
    if (!Array.isArray(l.images)) continue;
    const next = l.images.map(rewriteUrl);
    if (JSON.stringify(next) !== JSON.stringify(l.images)) {
      await supabase.from('marketplace_listings').update({ images: next }).eq('id', l.id);
      listingsUpdated += 1;
    }
  }
  console.log(`Updated ${listingsUpdated} marketplace listing image arrays.`);

  // Rewrite URLs in settings (user_banners, etc.)
  const { data: settingsRows } = await supabase.from('settings').select('key, value').in('key', ['user_banners']);
  for (const row of settingsRows || []) {
    if (typeof row.value === 'string' && row.value.includes(SUPA_PREFIX)) {
      const nextVal = row.value.split(SUPA_PREFIX).join(`${cdnUrl}/`);
      await supabase.from('settings').update({ value: nextVal, updated_at: new Date().toISOString() }).eq('key', row.key);
      console.log(`Updated settings key: ${row.key}`);
    }
  }

  if (deleteSource && allFiles.length > 0) {
    const paths = allFiles.map((f) => f.path);
    for (let i = 0; i < paths.length; i += 50) {
      await supabase.storage.from('card-images').remove(paths.slice(i, i + 50));
    }
    console.log(`Removed ${paths.length} migrated files from Supabase Storage.`);
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
