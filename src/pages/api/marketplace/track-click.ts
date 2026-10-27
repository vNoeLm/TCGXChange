import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import { getRequestUser } from '../../../lib/requestAuth';

export const prerender = false;

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

// In-memory cache for IP + item cooldown (1 hour)
const recentTrackingMap = new Map<string, number>();
const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

function cleanRecentTrackingMap() {
  if (recentTrackingMap.size > 10000) {
    const cutoff = Date.now() - COOLDOWN_MS;
    for (const [key, timestamp] of recentTrackingMap.entries()) {
      if (timestamp < cutoff) {
        recentTrackingMap.delete(key);
      }
    }
  }
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const { inventory_id, type = 'click' } = body;

    if (!inventory_id) {
      return new Response(JSON.stringify({ success: false, error: 'inventory_id is required' }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }

    // 0. Extract user if authenticated
    const caller = await getRequestUser(request);
    const user = caller?.user || null;

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
               request.headers.get('x-real-ip') ||
               'unknown';
    const cacheKey = `${ip}:${inventory_id}:${type}`;
    const now = Date.now();
    const lastTracked = recentTrackingMap.get(cacheKey);

    // 1. Try native marketplace_listings table first
    const { data: mktRow } = await supabaseAdmin
      .from('marketplace_listings')
      .select('id, seller_id, views, clicks')
      .eq('id', inventory_id)
      .maybeSingle();

    if (mktRow) {
      if (user && mktRow.seller_id === user.id) {
        return new Response(JSON.stringify({
          success: true,
          ignored: true,
          reason: 'seller_own_action',
          views: mktRow.views || 0,
          clicks: mktRow.clicks || 0,
        }), {
          status: 200,
          headers: JSON_HEADERS,
        });
      }

      if (lastTracked && (now - lastTracked) < COOLDOWN_MS) {
        return new Response(JSON.stringify({
          success: true,
          ignored: true,
          reason: 'cooldown',
          views: mktRow.views || 0,
          clicks: mktRow.clicks || 0,
        }), {
          status: 200,
          headers: JSON_HEADERS,
        });
      }

      cleanRecentTrackingMap();
      recentTrackingMap.set(cacheKey, now);

      const nextViews = (mktRow.views || 0) + (type === 'click' ? 0 : 1);
      const nextClicks = (mktRow.clicks || 0) + (type === 'click' ? 1 : 0);

      await supabaseAdmin
        .from('marketplace_listings')
        .update({ views: nextViews, clicks: nextClicks, updated_at: new Date().toISOString() })
        .eq('id', mktRow.id);

      return new Response(JSON.stringify({
        success: true,
        views: nextViews,
        clicks: nextClicks,
      }), {
        status: 200,
        headers: JSON_HEADERS,
      });
    }

    return new Response(JSON.stringify({ success: false, error: 'Listing not found' }), {
      status: 404,
      headers: JSON_HEADERS,
    });
  } catch (err: any) {
    console.warn('Track click/view error:', err);
    return new Response(JSON.stringify({ success: false, error: err.message || 'Server error' }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
};
