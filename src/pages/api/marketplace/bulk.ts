import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import {
  loadAllBulkListings,
  saveBulkListing,
  deleteBulkListingById,
  enrichSellerProfiles,
} from '../../../lib/bulkAndAuctionsServer';
import { getOrCreateConversation, postUserMessage } from '../../../lib/conversationsServer';
import { OWNER_ID } from '../../../lib/constants';
import type { MarketplaceBulkListing } from '../../../types';

export const prerender = false;

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

export const GET: APIRoute = async ({ url }) => {
  try {
    const game = url.searchParams.get('game');
    const sellerId = url.searchParams.get('seller_id');
    const sellerQuery = url.searchParams.get('seller')?.trim().toLowerCase() || '';
    const statusParam = url.searchParams.get('status');
    const search = url.searchParams.get('search')?.trim().toLowerCase() || '';
    const sort = url.searchParams.get('sort') || 'newest';

    let rows = await loadAllBulkListings();

    if (sellerId) {
      rows = rows.filter((r) => r.seller_id === sellerId);
    }
    if (statusParam && statusParam !== 'all') {
      if (statusParam === 'active' || statusParam === 'in_stock') {
        rows = rows.filter((r) => r.status === 'in_stock' || (r.status as string) === 'active' || r.status === 'on_hold');
      } else {
        rows = rows.filter((r) => r.status === statusParam);
      }
    }

    if (game && game !== 'all') {
      rows = rows.filter((r) => r.game === game);
    }

    if (search) {
      rows = rows.filter((r) => {
        const title = (r.title || '').toLowerCase();
        const desc = (r.description || '').toLowerCase();
        return title.includes(search) || desc.includes(search);
      });
    }

    let enriched = await enrichSellerProfiles(rows);

    if (sellerQuery) {
      enriched = enriched.filter((r) =>
        (r.seller_name || '').toLowerCase().includes(sellerQuery)
      );
    }

    if (sort === 'likes') {
      enriched.sort((a, b) => (b.likes_count || 0) - (a.likes_count || 0));
    } else if (sort === 'price_asc') {
      enriched.sort((a, b) => (a.price_huf || 0) - (b.price_huf || 0));
    } else if (sort === 'price_desc') {
      enriched.sort((a, b) => (b.price_huf || 0) - (a.price_huf || 0));
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: enriched,
        count: enriched.length,
      }),
      { status: 200, headers: JSON_HEADERS }
    );
  } catch (err: any) {
    console.error('Bulk listings GET error:', err);
    return new Response(
      JSON.stringify({ success: false, error: err?.message || 'Server error' }),
      { status: 500, headers: JSON_HEADERS }
    );
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized: please sign in.' }), {
        status: 401,
        headers: JSON_HEADERS,
      });
    }

    const token = authHeader.replace('Bearer ', '').trim();
    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid session.' }), {
        status: 401,
        headers: JSON_HEADERS,
      });
    }

    const body = await request.json().catch(() => ({}));

    // Action: Request Hold / Buy Bulk Listing
    if (body.action === 'request_hold') {
      const { bulk_id, preferred_handover = 'personal', message = '' } = body;
      const allBulk = await loadAllBulkListings();
      const target = allBulk.find((b) => b.id === bulk_id);
      if (!target) {
        return new Response(JSON.stringify({ success: false, error: 'Bulk listing not found.' }), {
          status: 404,
          headers: JSON_HEADERS,
        });
      }
      if (target.seller_id === user.id) {
        return new Response(JSON.stringify({ success: false, error: 'You cannot buy your own bulk listing.' }), {
          status: 400,
          headers: JSON_HEADERS,
        });
      }

      const convId = await getOrCreateConversation(user.id, target.seller_id);
      if (!convId) {
        return new Response(JSON.stringify({ success: false, error: 'Failed to open conversation.' }), {
          status: 500,
          headers: JSON_HEADERS,
        });
      }

      const { data: buyerProf } = await supabaseAdmin
        .from('profiles')
        .select('display_name')
        .eq('id', user.id)
        .maybeSingle();
      const buyerName = buyerProf?.display_name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'Buyer';

      const countDesc = target.exact_card_count
        ? `${target.exact_card_count} cards`
        : `~${target.approx_card_count} cards`;
      const userNote = message?.trim() ? `\n\n"${message.trim()}"` : '';
      const msgText = `[Bulk Hold Request] ${target.title} (${countDesc}) — ${target.price_huf.toLocaleString('hu-HU')} Ft${userNote}`;

      await postUserMessage(convId, user.id, msgText);

      const nowIso = new Date().toISOString();
      target.status = 'on_hold';
      target.updated_at = nowIso;
      await saveBulkListing(target);

      const holdPayload = {
        inventory_id: target.id,
        seller_id: target.seller_id,
        buyer_id: user.id,
        buyer_name: buyerName,
        buyer_email: user.email || '',
        preferred_handover,
        status: 'pending',
        card_name: `[Bulk] ${target.title} (${countDesc})`,
        card_number: 'BULK',
        image_path: target.images?.[0] || null,
        price_huf: target.price_huf,
        quantity: 1,
        conversation_id: convId,
        message: msgText,
        items: [{
          inventory_id: target.id,
          card_name: `[Bulk] ${target.title} (${countDesc})`,
          quantity: 1,
          price_huf: target.price_huf,
          is_bulk_lot: true,
        }],
        created_at: nowIso,
        updated_at: nowIso,
      };

      await supabaseAdmin.from('hold_requests').insert(holdPayload);

      return new Response(
        JSON.stringify({ success: true, conversation_id: convId }),
        { status: 200, headers: JSON_HEADERS }
      );
    }

    // Default Action: Create Bulk Listing
    const {
      title,
      game = 'riftbound',
      exact_card_count,
      approx_card_count,
      condition = 'Mixed',
      includes_foil = false,
      price_huf,
      handover_methods = ['personal', 'foxpost', 'packeta', 'other'],
      description = '',
      images = [],
    } = body;

    const exactCount = exact_card_count !== undefined && exact_card_count !== null && exact_card_count !== ''
      ? Math.max(0, parseInt(String(exact_card_count), 10))
      : null;
    const approxCount = approx_card_count !== undefined && approx_card_count !== null && approx_card_count !== ''
      ? Math.max(0, parseInt(String(approx_card_count), 10))
      : null;

    if ((!exactCount || exactCount <= 0) && (!approxCount || approxCount <= 0)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Please provide at least an exact card count or an approximate card count.',
        }),
        { status: 400, headers: JSON_HEADERS }
      );
    }

    if (!Array.isArray(images) || images.filter(Boolean).length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Please upload at least one photo of the bulk lot.',
        }),
        { status: 400, headers: JSON_HEADERS }
      );
    }

    const parsedPrice = Number(price_huf);
    if (!parsedPrice || parsedPrice <= 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Please enter a valid price.',
        }),
        { status: 400, headers: JSON_HEADERS }
      );
    }

    const nowIso = new Date().toISOString();
    const countLabel = exactCount ? `${exactCount} Cards` : `~${approxCount} Cards`;
    const newBulk: MarketplaceBulkListing = {
      id: crypto.randomUUID(),
      seller_id: user.id,
      seller_name: '',
      title: (title || '').trim() || `${game.toUpperCase()} Bulk Lot (${countLabel})`,
      game,
      exact_card_count: exactCount && exactCount > 0 ? exactCount : null,
      approx_card_count: approxCount && approxCount > 0 ? approxCount : null,
      condition,
      includes_foil: Boolean(includes_foil),
      price_huf: Math.round(parsedPrice),
      handover_methods: Array.isArray(handover_methods) && handover_methods.length > 0
        ? handover_methods
        : ['personal', 'foxpost', 'packeta', 'other'],
      description: description?.trim() || null,
      images: images.filter(Boolean),
      status: 'in_stock',
      likes_count: 0,
      views: 0,
      created_at: nowIso,
      updated_at: nowIso,
    };

    const saved = await saveBulkListing(newBulk);
    const [enriched] = await enrichSellerProfiles([saved]);

    return new Response(
      JSON.stringify({ success: true, data: enriched || saved }),
      { status: 201, headers: JSON_HEADERS }
    );
  } catch (err: any) {
    console.error('Bulk POST error:', err);
    return new Response(
      JSON.stringify({ success: false, error: err?.message || 'Server error' }),
      { status: 500, headers: JSON_HEADERS }
    );
  }
};

export const PATCH: APIRoute = async ({ request }) => {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized.' }), {
        status: 401,
        headers: JSON_HEADERS,
      });
    }

    const token = authHeader.replace('Bearer ', '').trim();
    const { data: { user } } = await supabaseAdmin.auth.getUser(token);
    if (!user) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized.' }), {
        status: 401,
        headers: JSON_HEADERS,
      });
    }

    const body = await request.json().catch(() => ({}));
    const { id, status, price_huf, title, description, exact_card_count, approx_card_count } = body;

    if (!id) {
      return new Response(JSON.stringify({ success: false, error: 'Missing bulk listing id.' }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }

    const allBulk = await loadAllBulkListings();
    const target = allBulk.find((b) => b.id === id);
    if (!target) {
      return new Response(JSON.stringify({ success: false, error: 'Bulk listing not found.' }), {
        status: 404,
        headers: JSON_HEADERS,
      });
    }

    if (target.seller_id !== user.id && user.id !== OWNER_ID) {
      return new Response(JSON.stringify({ success: false, error: 'Forbidden.' }), {
        status: 403,
        headers: JSON_HEADERS,
      });
    }

    const nowIso = new Date().toISOString();
    if (status) target.status = status;
    if (typeof price_huf === 'number' && price_huf > 0) target.price_huf = Math.round(price_huf);
    if (typeof title === 'string' && title.trim()) target.title = title.trim();
    if (description !== undefined) target.description = description?.trim() || null;
    if (exact_card_count !== undefined) target.exact_card_count = exact_card_count ? Number(exact_card_count) : null;
    if (approx_card_count !== undefined) target.approx_card_count = approx_card_count ? Number(approx_card_count) : null;
    target.updated_at = nowIso;

    await saveBulkListing(target);

    if (status === 'in_stock') {
      await supabaseAdmin
        .from('hold_requests')
        .update({ status: 'cancelled', updated_at: nowIso })
        .eq('inventory_id', id)
        .in('status', ['pending', 'held']);
    } else if (status === 'sold') {
      await supabaseAdmin
        .from('hold_requests')
        .update({ status: 'completed', updated_at: nowIso })
        .eq('inventory_id', id)
        .in('status', ['pending', 'held', 'handed_over', 'buyer_received']);
    }

    return new Response(JSON.stringify({ success: true, data: target }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  } catch (err: any) {
    console.error('Bulk PATCH error:', err);
    return new Response(
      JSON.stringify({ success: false, error: err?.message || 'Server error' }),
      { status: 500, headers: JSON_HEADERS }
    );
  }
};

export const DELETE: APIRoute = async ({ url, request }) => {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized.' }), {
        status: 401,
        headers: JSON_HEADERS,
      });
    }

    const token = authHeader.replace('Bearer ', '').trim();
    const { data: { user } } = await supabaseAdmin.auth.getUser(token);
    if (!user) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized.' }), {
        status: 401,
        headers: JSON_HEADERS,
      });
    }

    const id = url.searchParams.get('id');
    if (!id) {
      return new Response(JSON.stringify({ success: false, error: 'Missing id.' }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }

    const allBulk = await loadAllBulkListings();
    const target = allBulk.find((b) => b.id === id);
    if (!target || (target.seller_id !== user.id && user.id !== OWNER_ID)) {
      return new Response(JSON.stringify({ success: false, error: 'Forbidden.' }), {
        status: 403,
        headers: JSON_HEADERS,
      });
    }

    await deleteBulkListingById(id);

    return new Response(JSON.stringify({ success: true, id }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  } catch (err: any) {
    console.error('Bulk DELETE error:', err);
    return new Response(
      JSON.stringify({ success: false, error: err?.message || 'Server error' }),
      { status: 500, headers: JSON_HEADERS }
    );
  }
};
