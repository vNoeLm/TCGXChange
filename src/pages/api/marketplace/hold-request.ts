import type { APIRoute } from 'astro';
import { allowedHoldActions, sellerCanCompleteFrom, isPastConfirmTimeout, CONFIRM_TIMEOUT_DAYS, PENDING_HOLD_EXPIRY_HOURS, MAX_PENDING_HOLDS_PER_BUYER, type HoldAction, type HoldStatus } from '../../../lib/holdFlow';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import { getOrCreateConversation, postSystemMessage, postUserMessage } from '../../../lib/conversationsServer';
import { handoverMethod, handoverLabel, listingHandoverIds, type HandoverMethodId } from '../../../lib/handover';
import { methodAvailability, normalizeShipping, internationalRate, fmtHuf, type ShippingSettings } from '../../../lib/shipping';
import { collectionKey } from '../../../lib/sellerNotes';
import { adjustNamedCollectionCard } from '../../../lib/collectionsServer';
import { sanitizePlainText } from '../../../lib/sanitize';
import { notifySellerHoldRequest, notifyBuyerHoldDecision } from '../../../lib/emailNotifications';

export const prerender = false;
const holdRateMap = new Map<string, number>();
const HOLD_RATE_LIMIT_MS = 3000;


const BUYER_CONFIRM_DAYS_TEXT = `${CONFIRM_TIMEOUT_DAYS} days`;

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

import { OWNER_ID } from '../../../lib/constants';

export interface HoldRequestItem {
  inventory_id: string;
  card_name: string;
  card_number?: string;
  image_path?: string;
  price_huf: number;
  quantity: number;
  is_foil: boolean;
  condition: string;
}

export interface HoldRequestRecord {
  id: string;
  inventory_id: string;
  seller_id: string;
  buyer_id?: string | null;
  buyer_name: string;
  buyer_email: string;
  buyer_phone?: string;
  buyer_discord?: string;
  /** 'pickup' on requests made before in-person was stored as 'personal'. */
  preferred_handover: HandoverMethodId | 'pickup';
  handover_details?: string;
  message?: string;
  status: HoldStatus;
  /** The persistent buyer-seller conversation this request's chat belongs to (null for guest checkouts without an account). */
  conversation_id?: string | null;
  card_name?: string;
  card_number?: string;
  image_path?: string;
  price_huf?: number;
  quantity?: number;
  is_foil?: boolean;
  condition?: string;
  /** Present when this request bundles multiple cards from one seller (cart checkout). */
  items?: HoldRequestItem[];
  /** What the buyer pays for the chosen handover method (seller shipping options). */
  shipping_huf?: number;
  tracking_number?: string | null;
  created_at: string;
  updated_at: string;
}

/** The full item list for a request — falls back to its single legacy fields when `items` is absent. */
function itemsOf(req: HoldRequestRecord): HoldRequestItem[] {
  if (Array.isArray(req.items) && req.items.length > 0) return req.items;
  return [
    {
      inventory_id: req.inventory_id,
      card_name: req.card_name || 'TCG Card',
      card_number: req.card_number,
      image_path: req.image_path,
      price_huf: req.price_huf || 0,
      quantity: Math.max(1, Number(req.quantity) || 1),
      is_foil: Boolean(req.is_foil),
      condition: req.condition || 'Near Mint',
    },
  ];
}

// Fallback helper to read all hold requests from settings table if hold_requests table is not yet created
async function getFallbackHoldRequests(): Promise<HoldRequestRecord[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('settings')
      .select('value')
      .eq('key', 'marketplace_hold_requests')
      .maybeSingle();

    if (error || !data?.value) return [];
    const parsed = JSON.parse(data.value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

async function saveFallbackHoldRequests(requests: HoldRequestRecord[]): Promise<void> {
  try {
    await supabaseAdmin
      .from('settings')
      .upsert({
        key: 'marketplace_hold_requests',
        value: JSON.stringify(requests),
      }, { onConflict: 'key' });
  } catch (e) {
    console.error('Failed to save fallback hold requests:', e);
  }
}

// Helper to record a completed sale in store_orders so seller items sold count increments & buyer can rate seller
async function recordCompletedSaleInOrders(req: HoldRequestRecord): Promise<string | null> {
  try {
    const { data: currentOrdersRow } = await supabaseAdmin
      .from('settings')
      .select('value')
      .eq('key', 'store_orders')
      .maybeSingle();

    let ordersList: any[] = [];
    if (currentOrdersRow?.value) {
      try {
        const parsed = JSON.parse(currentOrdersRow.value);
        if (Array.isArray(parsed)) ordersList = parsed;
      } catch (e) {}
    }

    const lineItems = itemsOf(req);
    const shippingHuf = Math.max(0, Number(req.shipping_huf) || 0);
    const orderTotal = lineItems.reduce((sum, it) => sum + it.price_huf * it.quantity, 0) + shippingHuf;
    const orderNumber = `P2P-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;

    let sellerName: string | undefined;
    try {
      const { data: sellerProfile } = await supabaseAdmin
        .from('profiles')
        .select('display_name')
        .eq('id', req.seller_id)
        .maybeSingle();
      sellerName = sellerProfile?.display_name || undefined;
    } catch (e) {}

    const newOrder = {
      id: crypto.randomUUID(),
      order_number: orderNumber,
      hold_request_id: req.id,
      conversation_id: req.conversation_id || null,
      user_id: req.buyer_id || null,
      seller_id: req.seller_id,
      seller_name: sellerName,
      status: 'Delivered',
      total_price_huf: orderTotal,
      shipping_huf: shippingHuf,
      shipping_name: req.buyer_name,
      shipping_method: req.preferred_handover,
      shipping_address: req.handover_details || undefined,
      tracking_number: req.tracking_number || null,
      payment_method: 'cash_or_transfer',
      payment_status: 'paid',
      customer_info: {
        email: req.buyer_email,
        phone: req.buyer_phone || '',
        name: req.buyer_name,
      },
      // Conversation messages belong to the chat thread, not stored as order notes
      notes: undefined,
      items: lineItems.map((it) => ({
        inventory_id: it.inventory_id,
        card_id: it.inventory_id,
        card_name: it.card_name,
        card_number: it.card_number || '',
        condition: it.condition,
        is_foil: it.is_foil,
        price_huf: it.price_huf,
        quantity: it.quantity,
        image_path: it.image_path || '',
      })),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    ordersList.unshift(newOrder);

    await supabaseAdmin
      .from('settings')
      .upsert({
        key: 'store_orders',
        value: JSON.stringify(ordersList),
      }, { onConflict: 'key' });

    return orderNumber;
  } catch (err) {
    console.warn('Failed to record completed sale in store_orders:', err);
    return null;
  }
}

/** Automatically completes requests where one side confirmed but the second side didn't reply within 3 days. */
async function autoCompleteTimedOutRequests(requests: HoldRequestRecord[]): Promise<HoldRequestRecord[]> {
  const now = Date.now();
  let modified = false;

  for (let i = 0; i < requests.length; i++) {
    const req = requests[i];
    if ((req.status === 'handed_over' || req.status === 'buyer_received') && isPastConfirmTimeout(req.updated_at, now)) {
      const nowIso = new Date().toISOString();

      // Commit the status change first. If the write fails, leave the request alone so the next
      // read retries it instead of reporting a completed order that was never persisted.
      const { error: statusErr } = await supabaseAdmin
        .from('hold_requests')
        .update({ status: 'completed', updated_at: nowIso })
        .eq('id', req.id);

      if (statusErr) {
        console.warn('Could not auto-complete hold request', req.id, statusErr.message);
        continue;
      }

      const updatedReq: HoldRequestRecord = {
        ...req,
        status: 'completed',
        updated_at: nowIso,
      };
      requests[i] = updatedReq;
      modified = true;

      // 2. Mark the marketplace listing Sold once no stock remains.
      for (const item of itemsOf(req)) {
        if (!item.inventory_id) continue;
        try {
          const { data: mktRow } = await supabaseAdmin
            .from('marketplace_listings')
            .select('quantity, card_id, is_foil, collection_id')
            .eq('id', item.inventory_id)
            .maybeSingle();
          const currentQty = Number(mktRow?.quantity) || 0;
          await supabaseAdmin
            .from('marketplace_listings')
            .update({ status: currentQty > 0 ? 'In Stock' : 'Sold' })
            .eq('id', item.inventory_id);
          if (mktRow?.collection_id && mktRow?.card_id) {
            await adjustNamedCollectionCard(req.seller_id, mktRow.collection_id, collectionKey(mktRow.card_id, Boolean(mktRow.is_foil)), -Math.max(1, Number(item.quantity) || 1));
          }
        } catch (e: any) {
          console.warn('Could not finalize marketplace listing after auto-complete:', item.inventory_id, e?.message || e);
        }
      }

      // 3. Record order
      const orderNumber = await recordCompletedSaleInOrders(updatedReq);

      // 4. System message
      if (req.conversation_id) {
        try {
          const reason = req.status === 'handed_over'
            ? 'No response from buyer within 3 days — order auto-completed!'
            : 'No response from seller within 3 days — order auto-completed!';
          await postSystemMessage(req.conversation_id, req.seller_id, reason, {
            holdRequestId: req.id,
            metadata: {
              action: 'auto_completed',
              hold_request_id: req.id,
              completed: true,
              ...(orderNumber ? { order_number: orderNumber } : {}),
            },
          });
        } catch (e: any) {
          console.warn('Could not post auto-complete system message:', req.id, e?.message || e);
        }
      }
    }
  }

  if (modified) {
    await saveFallbackHoldRequests(requests);
  }
  return requests;
}

// ─── GET: Fetch Hold Requests ──────────────────────────────────────────
export const GET: APIRoute = async ({ url, request }) => {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized.' }), {
        status: 401,
        headers: JSON_HEADERS,
      });
    }

    const token = authHeader.replace('Bearer ', '').trim();
    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized.' }), {
        status: 401,
        headers: JSON_HEADERS,
      });
    }

    const sellerId = url.searchParams.get('seller_id');
    const buyerId = url.searchParams.get('buyer_id');
    const inventoryId = url.searchParams.get('inventory_id');

    // Only allow querying requests if the caller is the seller or the buyer (or the platform owner)
    if (sellerId && sellerId !== user.id && user.id !== OWNER_ID) {
      return new Response(JSON.stringify({ success: false, error: 'Forbidden.' }), {
        status: 403,
        headers: JSON_HEADERS,
      });
    }
    if (buyerId && buyerId !== user.id && user.id !== OWNER_ID) {
      return new Response(JSON.stringify({ success: false, error: 'Forbidden.' }), {
        status: 403,
        headers: JSON_HEADERS,
      });
    }

    let allRequests: HoldRequestRecord[] = [];

    // Release unanswered pending requests before reading the list, so neither side sees a dead one.
    await expireStalePendingHolds();

    // Push filtering to database level: query only records relevant to caller
    let dbQuery = supabaseAdmin.from('hold_requests').select('*');
    if (user.id !== OWNER_ID) {
      if (sellerId) {
        dbQuery = dbQuery.eq('seller_id', user.id);
      } else if (buyerId) {
        dbQuery = dbQuery.eq('buyer_id', user.id);
      } else if (inventoryId) {
        dbQuery = dbQuery.eq('inventory_id', inventoryId).or(`seller_id.eq.${user.id},buyer_id.eq.${user.id}`);
      } else {
        dbQuery = dbQuery.or(`seller_id.eq.${user.id},buyer_id.eq.${user.id}`);
      }
    } else {
      if (sellerId) dbQuery = dbQuery.eq('seller_id', sellerId);
      else if (buyerId) dbQuery = dbQuery.eq('buyer_id', buyerId);
      else if (inventoryId) dbQuery = dbQuery.eq('inventory_id', inventoryId);
    }

    const { data: dbData, error: dbErr } = await dbQuery.order('created_at', { ascending: false }).limit(200);

    if (!dbErr && Array.isArray(dbData)) {
      allRequests = dbData;
    } else {
      // Fallback to settings if table is not yet created
      const rawFallback = await getFallbackHoldRequests();
      allRequests = rawFallback.filter(r => {
        if (sellerId) return r.seller_id === sellerId;
        if (buyerId) return r.buyer_id === buyerId;
        if (inventoryId) return r.inventory_id === inventoryId && (r.seller_id === user.id || r.buyer_id === user.id || user.id === OWNER_ID);
        return r.seller_id === user.id || r.buyer_id === user.id || user.id === OWNER_ID;
      });
    }

    // Auto-complete any requests that have been waiting > 3 days without response from the second party
    allRequests = await autoCompleteTimedOutRequests(allRequests);

    return new Response(JSON.stringify({ success: true, data: allRequests }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err?.message || 'Failed to fetch hold requests' }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
};

interface CartLineInput {
  inventory_id: string;
  card_name?: string;
  card_number?: string;
  image_path?: string;
  price_huf?: number;
  is_foil?: boolean;
  condition?: string;
  quantity?: number;
}

type LockResult =
  | { ok: true; item: HoldRequestItem; verifiedSellerId: string }
  | { ok: false; error: string; status: number };

/**
 * Validates and atomically reserves one inventory row for a hold request. Shared by
 * both the single-card and multi-card (cart) request paths so a cart is just N of
 * these instead of duplicating the locking logic.
 */
async function lockOneInventoryItem(sellerIdHint: string, line: CartLineInput, handover: HandoverMethodId): Promise<LockResult> {
  // 1. Try marketplace_listings
  const { data: mktRow } = await supabaseAdmin
    .from('marketplace_listings')
    .select('id, seller_id, status, quantity, price_huf, condition, is_foil, handover_methods')
    .eq('id', line.inventory_id)
    .maybeSingle();

  if (mktRow) {
    if (mktRow.status === 'Sold' || (mktRow.quantity && mktRow.quantity <= 0)) {
      return { ok: false, error: 'This card has already been sold.', status: 400 };
    }
    if (mktRow.status === 'On Hold' || mktRow.status === 'Reserved') {
      return { ok: false, error: 'This card is currently on hold for another buyer.', status: 400 };
    }

    const availableQty = Number(mktRow.quantity) || 1;
    let requestedQty = parseInt(String(line.quantity), 10);
    if (!Number.isFinite(requestedQty) || requestedQty < 1) requestedQty = 1;
    if (requestedQty > availableQty) requestedQty = availableQty;

    const verifiedSellerId = mktRow.seller_id || sellerIdHint;
    const listedHandovers = Array.isArray(mktRow.handover_methods) ? mktRow.handover_methods : undefined;

    if (handover !== 'international' && !handover.startsWith('custom:') && !listingHandoverIds(listedHandovers).includes(handover)) {
      return {
        ok: false,
        error: `${line.card_name || 'One of these cards'} isn't offered with ${handoverLabel(handover)} - pick one of the methods the seller listed it with.`,
        status: 400,
      };
    }

    const remainingAfter = availableQty - requestedQty;
    const newStatus = remainingAfter > 0 ? mktRow.status : 'Reserved';

    const { data: lockedRows, error: lockErr } = await supabaseAdmin
      .from('marketplace_listings')
      .update({ quantity: remainingAfter, status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', line.inventory_id)
      .eq('quantity', availableQty)
      .in('status', ['In Stock', 'Available'])
      .select('id');

    if (lockErr || !lockedRows || lockedRows.length === 0) {
      return { ok: false, error: 'Another buyer just reserved or purchased this card.', status: 409 };
    }

    return {
      ok: true,
      verifiedSellerId,
      item: {
        inventory_id: line.inventory_id,
        card_name: line.card_name || 'TCG Card',
        card_number: line.card_number,
        image_path: line.image_path,
        price_huf: Math.max(0, Math.round(Number(mktRow.price_huf) || 0)),
        quantity: requestedQty,
        is_foil: Boolean(mktRow.is_foil),
        condition: mktRow.condition || 'Near Mint',
      },
    };
  }

  return { ok: false, error: 'That listing no longer exists.', status: 404 };
}

/** Best-effort rollback for a partially-locked cart: give back what a lock reserved. */
async function restoreInventoryItem(inventoryId: string, quantity: number): Promise<void> {
  try {
    const { data: mktRow } = await supabaseAdmin.from('marketplace_listings').select('quantity').eq('id', inventoryId).maybeSingle();
    const current = Number(mktRow?.quantity) || 0;
    await supabaseAdmin.from('marketplace_listings').update({ quantity: current + quantity, status: 'In Stock' }).eq('id', inventoryId);
  } catch (e) {
    console.warn('Failed to roll back listing lock for', inventoryId, e);
  }
}

/**
 * Releases pending requests that a seller never answered (48h by default). This is lazy: it runs
 * whenever hold requests are read or created, so no separate cron worker is needed. The claim
 * update is conditional on the row still being pending, which keeps two concurrent sweeps from
 * releasing the same stock twice.
 */
async function expireStalePendingHolds(buyerId?: string): Promise<void> {
  const cutoff = new Date(Date.now() - PENDING_HOLD_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();
  let query = supabaseAdmin
    .from('hold_requests')
    .select('*')
    .eq('status', 'pending')
    .lt('created_at', cutoff)
    .limit(50);
  if (buyerId) query = query.eq('buyer_id', buyerId);

  const { data, error } = await query;
  if (error) {
    console.warn('Could not scan for expired pending holds:', error.message);
    return;
  }

  for (const req of (data || []) as HoldRequestRecord[]) {
    const nowIso = new Date().toISOString();
    const { data: claimed, error: claimErr } = await supabaseAdmin
      .from('hold_requests')
      .update({ status: 'expired', updated_at: nowIso })
      .eq('id', req.id)
      .eq('status', 'pending')
      .select('id');

    if (claimErr || !claimed || claimed.length === 0) continue;

    for (const item of itemsOf(req)) {
      if (item.inventory_id) {
        await restoreInventoryItem(item.inventory_id, Math.max(1, Number(item.quantity) || 1));
      }
    }

    if (req.conversation_id) {
      await postSystemMessage(
        req.conversation_id,
        req.seller_id,
        `Hold request expired after ${PENDING_HOLD_EXPIRY_HOURS} hours without a seller response. The cards were released back to the seller.`,
        {
          holdRequestId: req.id,
          metadata: { action: 'expired', hold_request_id: req.id, expired: true },
        }
      );
    }
  }
}

// ─── POST: Submit a New Hold Request ─────────────────────────────────
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => null);
    if (!body) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid JSON body.' }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }

    // A request needs an account: the seller replies in a conversation, which is between two
    // accounts, and the buyer's contact email is the one they registered with rather than
    // whatever gets typed into a form.
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.replace('Bearer ', '').trim() : '';
    const { data: { user } } = token ? await supabaseAdmin.auth.getUser(token) : { data: { user: null } };
    if (!user) {
      return new Response(JSON.stringify({ success: false, error: 'Sign in to request a hold.' }), {
        status: 401,
        headers: JSON_HEADERS,
      });
    }
    const buyerId = user.id;

    // Lazy maintenance: release this buyer's unanswered pending holds before enforcing the cap.
    await expireStalePendingHolds(buyerId);

    const { count: pendingCount, error: pendingCountErr } = await supabaseAdmin
      .from('hold_requests')
      .select('id', { count: 'exact', head: true })
      .eq('buyer_id', buyerId)
      .eq('status', 'pending');

    if (pendingCountErr) {
      console.warn('Could not count pending hold requests:', pendingCountErr.message);
    } else if ((pendingCount || 0) >= MAX_PENDING_HOLDS_PER_BUYER) {
      return new Response(JSON.stringify({
        success: false,
        error: `You already have ${MAX_PENDING_HOLDS_PER_BUYER} pending hold requests. Wait for sellers to respond or cancel one before sending another.`,
      }), {
        status: 429,
        headers: JSON_HEADERS,
      });
    }

    const {
      seller_id,
      buyer_name,
      buyer_phone,
      preferred_handover,
      handover_details,
      message,
      items: cartItems,
      // Legacy single-card fields, used when `items` isn't provided
      inventory_id,
      card_name,
      card_number,
      image_path,
      price_huf,
      is_foil,
      condition,
      quantity,
    } = body;

    // Rate-limit per (buyer, seller) pair so multi-seller cart submissions (which send separate
    // requests for each distinct seller in the cart at the exact same moment) do not block each other.
    const rateLimitKey = seller_id ? `${buyerId}::${seller_id}` : buyerId;
    const lastTime = holdRateMap.get(rateLimitKey) || 0;
    if (Date.now() - lastTime < HOLD_RATE_LIMIT_MS) {
      return new Response(JSON.stringify({ success: false, error: 'Please wait a few seconds before submitting another request to this seller.' }), {
        status: 429,
        headers: JSON_HEADERS,
      });
    }
    holdRateMap.set(rateLimitKey, Date.now());
    if (holdRateMap.size > 2000) {
      const cutoff = Date.now() - 60000;
      for (const [k, v] of holdRateMap.entries()) {
        if (v < cutoff) holdRateMap.delete(k);
      }
    }

    const rawLines: CartLineInput[] = Array.isArray(cartItems) && cartItems.length > 0
      ? cartItems
      : [{ inventory_id, card_name, card_number, image_path, price_huf, is_foil, condition, quantity }];

    if (!seller_id || !rawLines[0]?.inventory_id) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing details (card or seller).',
      }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }

    const method = handoverMethod(preferred_handover);
    if (!method) {
      return new Response(JSON.stringify({ success: false, error: 'Choose a handover method.' }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }
    // Shipping needs somewhere to ship to; "Other" needs the arrangement described. In person
    // is worked out in the conversation, so it needs nothing up front.
    const detailsText = sanitizePlainText(handover_details, 300);
    if (method.kind !== 'personal' && !detailsText) {
      return new Response(JSON.stringify({
        success: false,
        error: method.kind === 'custom'
          ? 'Describe how you want to arrange the handover.'
          : `Add your delivery details for ${method.label}.`,
      }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }

    const { data: buyerProfile } = await supabaseAdmin
      .from('profiles')
      .select('display_name')
      .eq('id', buyerId)
      .maybeSingle();
    const buyerName = buyerProfile?.display_name
      || (typeof buyer_name === 'string' && buyer_name.trim())
      || user.user_metadata?.full_name
      || (user.email || 'Buyer').split('@')[0];

    // Lock every card in the request (one for a normal hold, several for a cart
    // checkout), rolling back anything already locked if a later one fails or
    // turns out to belong to a different seller.
    const lockedItems: HoldRequestItem[] = [];
    const lockedForRollback: { id: string; quantity: number }[] = [];
    let verifiedSellerId: string | null = null;

    for (const line of rawLines) {
      if (!line?.inventory_id) continue;
      const result = await lockOneInventoryItem(seller_id, line, method.id);
      if (!result.ok) {
        for (const locked of lockedForRollback) await restoreInventoryItem(locked.id, locked.quantity);
        return new Response(JSON.stringify({ success: false, error: result.error }), {
          status: result.status,
          headers: JSON_HEADERS,
        });
      }
      if (verifiedSellerId === null) {
        verifiedSellerId = result.verifiedSellerId;
      } else if (result.verifiedSellerId !== verifiedSellerId) {
        await restoreInventoryItem(line.inventory_id, result.item.quantity);
        for (const locked of lockedForRollback) await restoreInventoryItem(locked.id, locked.quantity);
        return new Response(JSON.stringify({
          success: false,
          error: 'All cards in one request must be from the same seller.',
        }), {
          status: 400,
          headers: JSON_HEADERS,
        });
      }
      lockedItems.push(result.item);
      lockedForRollback.push({ id: line.inventory_id, quantity: result.item.quantity });
    }

    if (lockedItems.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'No valid cards in this request.' }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }

    // The seller's shipping options: is this method offered, is the order big enough for it, and
    // what does it cost. Checked against the listing prices just locked, not the cart's figures.
    const { data: shippingRow } = await supabaseAdmin
      .from('seller_shipping')
      .select('options')
      .eq('seller_id', verifiedSellerId!)
      .maybeSingle()
      .then((r) => r, () => ({ data: null }));
    const shippingSettings: ShippingSettings | null = shippingRow ? normalizeShipping((shippingRow as any).options) : null;
    const subtotalHuf = lockedItems.reduce((sum, it) => sum + (it.price_huf || 0) * (it.quantity || 1), 0);
    const buyerCountry = (typeof body.buyer_country === 'string' && body.buyer_country.trim().toUpperCase()) || 'HU';

    // The seller's own country decides whether this is domestic or cross-border. A missing
    // country column (migration not applied yet) falls back to the old Hungary-only behaviour.
    let sellerCountry = 'HU';
    try {
      const { data: sellerProf } = await supabaseAdmin
        .from('profiles')
        .select('country')
        .eq('id', verifiedSellerId!)
        .maybeSingle();
      sellerCountry = ((sellerProf as any)?.country || 'HU').toUpperCase();
    } catch {}

    const crossBorder = buyerCountry !== sellerCountry;
    const availability = crossBorder
      ? (() => {
          const rate = internationalRate(shippingSettings, buyerCountry);
          return { offered: rate !== null, price: rate ?? 0, min: 0, short: 0 };
        })()
      : methodAvailability(shippingSettings, method.id, subtotalHuf);

    // A domestic handover method cannot be used for a cross-border order, and the international
    // method is only valid when buyer and seller are in different countries.
    if ((!crossBorder && method.id === 'international') || (crossBorder && method.id !== 'international')) {
      for (const locked of lockedForRollback) await restoreInventoryItem(locked.id, locked.quantity);
      return new Response(JSON.stringify({
        success: false,
        error: crossBorder ? 'Choose international shipping for this order.' : 'Choose a domestic handover method.',
      }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }

    if (!availability.offered || availability.short > 0) {
      for (const locked of lockedForRollback) await restoreInventoryItem(locked.id, locked.quantity);
      return new Response(JSON.stringify({
        success: false,
        error: !availability.offered
          ? crossBorder
            ? `This seller doesn't ship to ${buyerCountry}.`
            : `This seller doesn't offer ${method.label}.`
          : `${method.label} needs an order of at least ${fmtHuf(availability.min)} from this seller - add ${fmtHuf(availability.short)} more or pick another method.`,
      }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }
    const shippingHuf = availability.price;

    const first = lockedItems[0];
    const isCart = lockedItems.length > 1;

    // Reusing the buyer's existing conversation with this seller, if any, is the whole point: a
    // new purchase becomes an event in that same ongoing thread instead of starting a fresh one.
    const conversationId = await getOrCreateConversation(buyerId, verifiedSellerId!);

    const newRecord: HoldRequestRecord = {
      id: crypto.randomUUID(),
      inventory_id: first.inventory_id,
      seller_id: verifiedSellerId!,
      buyer_id: buyerId,
      buyer_name: sanitizePlainText(buyerName, 100),
      buyer_email: user.email || '',
      buyer_phone: buyer_phone ? sanitizePlainText(buyer_phone, 50) : undefined,
      preferred_handover: method.id,
      handover_details: detailsText || undefined,
      message: message ? sanitizePlainText(message, 500) : undefined,
      status: 'pending',
      card_name: first.card_name,
      card_number: first.card_number,
      image_path: first.image_path,
      price_huf: first.price_huf,
      quantity: first.quantity,
      is_foil: first.is_foil,
      condition: first.condition,
      items: isCart ? lockedItems : undefined,
      // Only written when there is a charge, so requests still save before the shipping migration.
      ...(shippingHuf > 0 ? { shipping_huf: shippingHuf } : {}),
      conversation_id: conversationId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Attempt insert into primary table
    const { data: insertedDb, error: insertErr } = await supabaseAdmin
      .from('hold_requests')
      .insert(newRecord)
      .select()
      .maybeSingle();

    if (insertErr) {
      // Table doesn't exist or RLS issue; write to settings fallback
      const currentList = await getFallbackHoldRequests();
      currentList.unshift(newRecord);
      await saveFallbackHoldRequests(currentList);
    }

    if (conversationId) {
      const cardLabel = isCart ? `${lockedItems.length} cards` : first.card_name;
      const totalHuf = subtotalHuf + shippingHuf;
      await postSystemMessage(
        conversationId,
        buyerId,
        `Requested a hold on ${cardLabel} — ${totalHuf.toLocaleString()} Ft · ${method.label}${shippingHuf > 0 ? ` (incl. ${shippingHuf.toLocaleString()} Ft shipping)` : ''}`,
        {
          holdRequestId: newRecord.id,
          metadata: {
            action: 'requested',
            hold_request_id: newRecord.id,
            card_name: cardLabel,
            price_huf: totalHuf,
            shipping_huf: shippingHuf,
            handover: method.id,
            handover_details: detailsText || null,
          },
        }
      );
      // The buyer's note is a message to the seller, so it goes in the chat as one - it used to
      // be stored only on the request, where just the Seller Hub showed it.
      const note = typeof message === 'string' ? message.trim() : '';
      if (note) await postUserMessage(conversationId, buyerId, note);
    }

    // Fire-and-forget email notification to the seller (via Resend when configured)
    (async () => {
      try {
        const { data: sellerProf } = await supabaseAdmin
          .from('profiles')
          .select('email, display_name')
          .eq('id', verifiedSellerId!)
          .maybeSingle();
        const cardLabel = isCart ? `${lockedItems.length} cards` : first.card_name;
        await notifySellerHoldRequest({
          sellerEmail: (sellerProf as any)?.email || null,
          sellerName: (sellerProf as any)?.display_name || 'Seller',
          buyerName: newRecord.buyer_name,
          cardSummary: cardLabel,
          totalHuf: subtotalHuf + shippingHuf,
          handoverLabel: method.label,
        });
      } catch {}
    })();

    return new Response(JSON.stringify({
      success: true,
      data: insertedDb || newRecord,
      message: 'Hold request sent to the seller.',
    }), {
      status: 201,
      headers: JSON_HEADERS,
    });
  } catch (err: any) {
    console.error('Error submitting hold request:', err);
    return new Response(JSON.stringify({ success: false, error: err?.message || 'Server error' }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
};

// ─── PATCH: Seller / Buyer Updates Hold Status ─────────────────────────
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
    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized.' }), {
        status: 401,
        headers: JSON_HEADERS,
      });
    }

    const body = await request.json().catch(() => null);
    const id = body?.id || body?.request_id;
    if (!body || !id || !body.action) {
      return new Response(JSON.stringify({ success: false, error: 'Missing id or action.' }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }

    // Who may do what, and when, is in lib/holdFlow.ts - the buyer completes a sale by
    // confirming they received the card; the seller only marks it handed over.
    const action = body.action as HoldAction;

    // Fetch existing request
    let currentReq: HoldRequestRecord | null = null;
    const { data: dbItem } = await supabaseAdmin
      .from('hold_requests')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (dbItem) {
      currentReq = dbItem;
    } else {
      const fallbackList = await getFallbackHoldRequests();
      currentReq = fallbackList.find(r => r.id === id) || null;
    }

    if (!currentReq) {
      return new Response(JSON.stringify({ success: false, error: 'Hold request not found.' }), {
        status: 404,
        headers: JSON_HEADERS,
      });
    }

    const isSeller = currentReq.seller_id === user.id;
    const isBuyer = currentReq.buyer_id === user.id;
    if (!isSeller && !isBuyer) {
      return new Response(JSON.stringify({ success: false, error: 'Forbidden.' }), {
        status: 403,
        headers: JSON_HEADERS,
      });
    }

    if (action === 'update_tracking') {
      if (!isSeller) {
        return new Response(JSON.stringify({ success: false, error: 'Only the seller can update tracking.' }), {
          status: 403,
          headers: JSON_HEADERS,
        });
      }
      const trackingNumber = typeof body.tracking_number === 'string' ? body.tracking_number.trim() : null;
      const nowIso = new Date().toISOString();
      const updatedReq: HoldRequestRecord = {
        ...currentReq,
        tracking_number: trackingNumber,
        updated_at: nowIso,
      };
      if (dbItem) {
        try {
          await supabaseAdmin
            .from('hold_requests')
            .update({ tracking_number: trackingNumber, updated_at: nowIso })
            .eq('id', id);
        } catch (e) {
          console.warn('Could not update tracking_number directly:', e);
        }
      }
      const fallbackList = await getFallbackHoldRequests();
      const idx = fallbackList.findIndex(r => r.id === id);
      if (idx >= 0) fallbackList[idx] = updatedReq;
      else fallbackList.unshift(updatedReq);
      await saveFallbackHoldRequests(fallbackList);

      if (currentReq.conversation_id && trackingNumber) {
        await postSystemMessage(currentReq.conversation_id, user.id, `Tracking number added: ${trackingNumber}`, {
          holdRequestId: id,
          metadata: { action: 'update_tracking', tracking_number: trackingNumber },
        });
      }

      return new Response(JSON.stringify({
        success: true,
        data: updatedReq,
      }), {
        status: 200,
        headers: JSON_HEADERS,
      });
    }

    const allowed = allowedHoldActions(currentReq.status, isSeller ? 'seller' : 'buyer', currentReq.updated_at);
    if (!allowed.includes(action)) {
      const error = action === 'confirm_sale' && currentReq.status === 'handed_over'
        ? `The buyer has until ${sellerCanCompleteFrom(currentReq.updated_at).toLocaleDateString('en-GB')} to confirm or deny.`
        : action === 'confirm_sale' && currentReq.status === 'buyer_received'
        ? `The seller has until ${sellerCanCompleteFrom(currentReq.updated_at).toLocaleDateString('en-GB')} to confirm or deny.`
        : action === 'release' && currentReq.status === 'handed_over'
        ? 'This has already been handed over — message the other party or click Deny if something is wrong.'
        : `This request is ${currentReq.status.replace('_', ' ')} - that can't be done now.`;
      return new Response(JSON.stringify({ success: false, error }), {
        status: 409,
        headers: JSON_HEADERS,
      });
    }

    const completes = (action === 'confirm_received' && currentReq.status === 'handed_over') || action === 'confirm_sale';
    const trackingNumber = typeof body.tracking_number === 'string' ? body.tracking_number.trim() : currentReq.tracking_number;
    const newStatus: HoldStatus =
      action === 'hold' ? 'held'
      : action === 'reject' ? 'rejected'
      : (action === 'release' || action === 'deny') ? 'cancelled'
      : action === 'mark_handed_over' ? 'handed_over'
      : (action === 'confirm_received' && currentReq.status === 'held') ? 'buyer_received'
      : 'completed';
    let newInventoryStatus: 'In Stock' | 'Reserved' | 'Sold' =
      (action === 'hold' || newStatus === 'handed_over' || newStatus === 'buyer_received') ? 'Reserved' : completes ? 'Sold' : 'In Stock';

    const nowIso = new Date().toISOString();
    const updatedReq: HoldRequestRecord = {
      ...currentReq,
      status: newStatus,
      updated_at: nowIso,
      tracking_number: trackingNumber,
    };

    // 1. Update hold request table or fallback. Only if it's still in the state it was read in -
    // two clicks (or both people) acting at once must not complete a sale twice.
    if (dbItem) {
      let changed = null;
      try {
        const res = await supabaseAdmin
          .from('hold_requests')
          .update({ status: newStatus, updated_at: nowIso, ...(trackingNumber ? { tracking_number: trackingNumber } : {}) })
          .eq('id', id)
          .eq('status', currentReq.status)
          .select('id');
        changed = res.data;
      } catch {
        const res = await supabaseAdmin
          .from('hold_requests')
          .update({ status: newStatus, updated_at: nowIso })
          .eq('id', id)
          .eq('status', currentReq.status)
          .select('id');
        changed = res.data;
      }
      if (!changed || changed.length === 0) {
        return new Response(JSON.stringify({ success: false, error: 'This request was just updated - refresh and try again.' }), {
          status: 409,
          headers: JSON_HEADERS,
        });
      }
    }

    const fallbackList = await getFallbackHoldRequests();
    const idx = fallbackList.findIndex(r => r.id === id);
    if (idx >= 0) {
      fallbackList[idx] = updatedReq;
    } else {
      fallbackList.unshift(updatedReq);
    }
    await saveFallbackHoldRequests(fallbackList);

    // 2. Update inventory table status/quantity for every card on this request.
    // The requested quantity was already deducted from inventory.quantity when the hold
    // request was created (see POST above), so here we only need to restore it on
    // release/reject/deny, and decide each item's final status from however much stock remains.
    // Handing over or buyer confirming first changes nothing in stock - the card stays reserved until the sale completes.
    for (const item of (newStatus === 'handed_over' || newStatus === 'buyer_received') ? [] : itemsOf(currentReq)) {
      if (!item.inventory_id) continue;
      const requestQty = Math.max(1, Number(item.quantity) || 1);

      const { data: currentMkt } = await supabaseAdmin
        .from('marketplace_listings')
        .select('quantity, card_id, is_foil, collection_id')
        .eq('id', item.inventory_id)
        .maybeSingle();

      const currentQty = Number(currentMkt?.quantity) || 0;
      const updateData: any = {};
      if (action === 'release' || action === 'reject' || action === 'deny') {
        updateData.quantity = currentQty + requestQty;
        updateData.status = 'In Stock';
      } else if (action === 'hold') {
        updateData.status = currentQty > 0 ? 'In Stock' : 'Reserved';
      } else if (completes) {
        updateData.status = currentQty > 0 ? 'In Stock' : 'Sold';
        if (currentMkt?.collection_id && currentMkt?.card_id) {
          await adjustNamedCollectionCard(currentReq.seller_id, currentMkt.collection_id, collectionKey(currentMkt.card_id, Boolean(currentMkt.is_foil)), -requestQty);
        }
      }
      newInventoryStatus = updateData.status || newInventoryStatus;
      await supabaseAdmin.from('marketplace_listings').update(updateData).eq('id', item.inventory_id);
    }

    // 3. If confirming sale, record completed order so seller ratings and sales count are enabled.
    // The seller's collection was already decremented when the card was first listed, not here.
    let completedOrderNumber: string | null = null;
    if (completes) {
      completedOrderNumber = await recordCompletedSaleInOrders(updatedReq);
    }

    // 4. Post a system message into the conversation so the buyer/seller see the status
    // change inline in their chat, instead of only in the seller dashboard's status pills.
    if (currentReq.conversation_id) {
      const actionMessages: Record<string, { body: string; sender: string }> = {
        hold: { body: 'Accepted the hold — this card is reserved.', sender: currentReq.seller_id },
        release: { body: 'Hold released — the card is back in stock.', sender: user.id },
        reject: { body: 'Hold request rejected.', sender: currentReq.seller_id },
        deny: currentReq.status === 'handed_over'
          ? { body: 'Buyer reported they did not receive the card — hold cancelled.', sender: user.id }
          : { body: 'Seller reported the card was not handed over — hold cancelled.', sender: user.id },
        mark_handed_over: {
          body: trackingNumber
            ? `Marked as handed over / sent (Tracking: ${trackingNumber}). The buyer has 3 days to confirm or deny before it auto-completes.`
            : 'Marked as handed over / sent. The buyer has 3 days to confirm or deny before it auto-completes.',
          sender: currentReq.seller_id
        },
        confirm_received: newStatus === 'buyer_received'
          ? { body: 'Confirmed receiving the card — waiting for seller OK or denial (auto-completes in 3 days).', sender: currentReq.buyer_id || user.id }
          : { body: 'Received the card — sale completed!', sender: currentReq.buyer_id || user.id },
        confirm_sale: currentReq.status === 'buyer_received'
          ? { body: 'Seller confirmed handover — sale completed!', sender: currentReq.seller_id }
          : { body: `No response within ${BUYER_CONFIRM_DAYS_TEXT} of handover — sale completed!`, sender: currentReq.seller_id },
      };
      const entry = actionMessages[action];
      if (entry) {
        await postSystemMessage(currentReq.conversation_id, entry.sender, entry.body, {
          holdRequestId: id,
          metadata: {
            action,
            hold_request_id: id,
            completed: completes,
            ...(completedOrderNumber ? { order_number: completedOrderNumber } : {}),
          },
        });
      }
    }

    // Fire-and-forget buyer email notification when seller accepts, rejects, or ships the hold request
    if (action === 'hold' || action === 'reject' || action === 'mark_handed_over') {
      (async () => {
        try {
          const decision = action === 'hold' ? 'accepted' : action === 'reject' ? 'rejected' : 'shipped';
          const items = itemsOf(currentReq);
          const summary = items.length > 1 ? `${items.length} cards` : (items[0]?.card_name || 'TCG Card');
          await notifyBuyerHoldDecision({
            buyerEmail: currentReq.buyer_email || null,
            buyerName: currentReq.buyer_name,
            decision,
            cardSummary: summary,
            trackingNumber: trackingNumber || updatedReq.tracking_number || null,
          });
        } catch {}
      })();
    }

    return new Response(JSON.stringify({
      success: true,
      data: updatedReq,
      new_inventory_status: newInventoryStatus,
    }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  } catch (err: any) {
    console.error('Error updating hold request:', err);
    return new Response(JSON.stringify({ success: false, error: err?.message || 'Server error' }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
};
