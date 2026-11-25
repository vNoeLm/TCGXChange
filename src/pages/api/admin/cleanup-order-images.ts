import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import { getRequestUser } from '../../../lib/requestAuth';
import { IMAGE_CDN_URL } from '../../../lib/supabase';
import { deleteObjectsFromR2 } from '../../../lib/r2Storage';
import type { Order } from '../../../types';

export const prerender = false;

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

async function isAuthorized(request: Request): Promise<boolean> {
  // 1. Cron secret token header check (for scheduled jobs / GitHub Actions / Supabase pg_cron)
  const cronSecret = process.env.CRON_SECRET || (import.meta as any).env?.CRON_SECRET;
  const headerSecret = request.headers.get('x-cron-secret') || request.headers.get('x-api-key');
  if (cronSecret && headerSecret === cronSecret) {
    return true;
  }

  // 2. Admin Bearer Token check via centralized auth
  const caller = await getRequestUser(request);
  return Boolean(caller?.isAdmin);
}

/**
 * Extracts storage relative file path from public URL.
 * e.g. "https://xxx.supabase.co/storage/v1/object/public/card-images/marketplace/123/img.webp"
 * -> "marketplace/123/img.webp"
 */
function extractStoragePath(url: string): string | null {
  if (!url || typeof url !== 'string') return null;
  const cdnPrefix = `${IMAGE_CDN_URL}/`;
  if (url.toLowerCase().startsWith(cdnPrefix.toLowerCase())) {
    return decodeURIComponent(url.slice(cdnPrefix.length).split('?')[0]);
  }
  const marker = '/card-images/';
  const idx = url.indexOf(marker);
  if (idx !== -1) {
    return decodeURIComponent(url.substring(idx + marker.length).split('?')[0]);
  }
  if (url.startsWith('marketplace/')) {
    return url;
  }
  return null;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const authorized = await isAuthorized(request);
    if (!authorized) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized: Admin or CRON secret required.' }), {
        status: 401,
        headers: JSON_HEADERS,
      });
    }

    const now = Date.now();
    const cutoffDate = new Date(now - FOURTEEN_DAYS_MS);

    // 1. Fetch all store orders from settings
    const { data: settingsData } = await supabaseAdmin
      .from('settings')
      .select('value')
      .eq('key', 'store_orders')
      .maybeSingle();

    let allOrders: Order[] = [];
    if (settingsData?.value) {
      try {
        const parsed = JSON.parse(settingsData.value);
        if (Array.isArray(parsed)) allOrders = parsed;
      } catch {}
    }

    // Also fetch public.orders if present
    const { data: tableOrders } = await supabaseAdmin
      .from('orders')
      .select('*');

    if (Array.isArray(tableOrders)) {
      const existing = new Set(allOrders.map(o => o.order_number));
      tableOrders.forEach((o: any) => {
        if (!existing.has(o.order_number)) allOrders.push(o as Order);
      });
    }

    // 2. Identify delivered / completed orders past the 14-day statutory dispute window
    const eligibleOrders = allOrders.filter((order) => {
      const status = String(order.status || '').toLowerCase();
      const isDelivered = status === 'delivered' || status === 'completed';
      if (!isDelivered) return false;

      const orderTime = new Date(order.updated_at || order.created_at).getTime();
      return (now - orderTime) >= FOURTEEN_DAYS_MS;
    });

    // 3. Collect candidate image URLs from eligible completed orders
    const candidateUrls = new Set<string>();
    for (const order of eligibleOrders) {
      if (Array.isArray(order.items)) {
        for (const it of order.items as any[]) {
          if (Array.isArray(it.photos)) {
            it.photos.forEach((p: string) => candidateUrls.add(p));
          }
          if (Array.isArray(it.images)) {
            it.images.forEach((p: string) => candidateUrls.add(p));
          }
        }
      }
    }

    if (candidateUrls.size === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No delivered orders older than 14 days with photos found.',
        deletedCount: 0,
        eligibleOrdersCount: eligibleOrders.length,
      }), {
        status: 200,
        headers: JSON_HEADERS,
      });
    }

    // 4. Fetch all active listing photos so an image still in use is never deleted.
    const activePathsSet = new Set<string>();

    const { data: activeListings } = await supabaseAdmin
      .from('marketplace_listings')
      .select('images');
    (activeListings || []).forEach((row: any) => {
      if (Array.isArray(row.images)) {
        row.images.forEach((url: string) => {
          const p = extractStoragePath(url);
          if (p) activePathsSet.add(p);
        });
      }
    });

    const { data: storeProducts } = await supabaseAdmin
      .from('store_products')
      .select('images');
    (storeProducts || []).forEach((row: any) => {
      if (Array.isArray(row.images)) {
        row.images.forEach((url: string) => {
          const p = extractStoragePath(url);
          if (p) activePathsSet.add(p);
        });
      }
    });

    // 5. Filter out active paths, keep only paths safe to delete
    const pathsToDelete: string[] = [];
    candidateUrls.forEach((url) => {
      const storagePath = extractStoragePath(url);
      if (storagePath && storagePath.startsWith('marketplace/') && !activePathsSet.has(storagePath)) {
        pathsToDelete.push(storagePath);
      }
    });

    if (pathsToDelete.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'Candidate photos are still active in listings. None deleted.',
        deletedCount: 0,
        eligibleOrdersCount: eligibleOrders.length,
      }), {
        status: 200,
        headers: JSON_HEADERS,
      });
    }

    // 6. Delete from Cloudflare R2 (and best-effort cleanup for any legacy Supabase Storage copies)
    const r2Result = await deleteObjectsFromR2(pathsToDelete);
    let totalDeleted = r2Result.deleted;
    const errors: any[] = [...r2Result.errors];

    try {
      const batchSize = 50;
      for (let i = 0; i < pathsToDelete.length; i += batchSize) {
        const batch = pathsToDelete.slice(i, i + batchSize);
        await supabaseAdmin.storage.from('card-images').remove(batch);
      }
    } catch {}

    return new Response(JSON.stringify({
      success: true,
      message: `Cleaned up ${totalDeleted} photos from delivered orders past 14 days.`,
      deletedCount: totalDeleted,
      eligibleOrdersCount: eligibleOrders.length,
      errors: errors.length > 0 ? errors : undefined,
    }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  } catch (err: any) {
    console.error('Error during cleanup-order-images:', err);
    return new Response(JSON.stringify({
      success: false,
      error: err?.message || 'Internal server error during image cleanup.',
    }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
};
