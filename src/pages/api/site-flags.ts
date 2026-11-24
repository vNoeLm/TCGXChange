import type { APIRoute } from 'astro';
import { getRequestUser, jsonResponse } from '../../lib/requestAuth';
import { getSiteFlagsServer, saveSiteFlagsServer } from '../../lib/siteFlagsServer';
import type { SiteFeatureFlags } from '../../lib/siteFlags';

export const prerender = false;

export const GET: APIRoute = async () => {
  const flags = await getSiteFlagsServer();
  return new Response(JSON.stringify({ success: true, flags }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=15, stale-while-revalidate=30',
    },
  });
};

async function handleUpdate(request: Request) {
  const caller = await getRequestUser(request);
  if (!caller) {
    return jsonResponse({ success: false, error: 'Unauthorized.' }, 401);
  }
  if (!caller.isAdmin) {
    return jsonResponse({ success: false, error: 'Admin access required.' }, 403);
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return jsonResponse({ success: false, error: 'Invalid request body.' }, 400);
  }

  const patch: Partial<SiteFeatureFlags> = {};
  if (typeof body.p2p_public === 'boolean') patch.p2p_public = body.p2p_public;
  if (typeof body.store_public === 'boolean') patch.store_public = body.store_public;
  if (typeof body.official_company_info === 'boolean') patch.official_company_info = body.official_company_info;

  if (Object.keys(patch).length === 0) {
    return jsonResponse({ success: false, error: 'No valid flags provided.' }, 400);
  }

  try {
    const flags = await saveSiteFlagsServer(patch);
    return jsonResponse({ success: true, flags }, 200);
  } catch (err: any) {
    return jsonResponse({ success: false, error: err?.message || 'Failed to save site flags.' }, 500);
  }
}

export const POST: APIRoute = async ({ request }) => handleUpdate(request);
export const PATCH: APIRoute = async ({ request }) => handleUpdate(request);
