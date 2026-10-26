import { supabaseAdmin } from './supabaseServer';
import { getOrCreateConversation, postSystemMessage, postUserMessage } from './conversationsServer';
import { OWNER_ID } from './constants';
import { getSellerTier } from './badges';
import { loadTradeOrders } from './tradeOrders';
import type { MarketplaceBulkListing, MarketplaceAuction } from '../types';

const BULK_SETTINGS_KEY = 'marketplace_bulk_listings';
const AUCTIONS_SETTINGS_KEY = 'marketplace_auctions';

const isTableMissing = (err: any) =>
  Boolean(err && (err.code === '42P01' || err.code === 'PGRST205' || /schema cache|does not exist/i.test(err.message || '')));

// ─── Settings Blob Helpers (Seamless DB persistence before/after SQL migration) ───

async function readSettingsArray<T>(key: string): Promise<T[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('settings')
      .select('value')
      .eq('key', key)
      .maybeSingle();
    if (error || !data?.value) return [];
    const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeSettingsArray<T>(key: string, items: T[]): Promise<void> {
  try {
    await supabaseAdmin
      .from('settings')
      .upsert({ key, value: JSON.stringify(items), updated_at: new Date().toISOString() }, { onConflict: 'key' });
  } catch (e) {
    console.warn(`Failed to write settings key ${key}:`, e);
  }
}

// ─── Seller Profile Enrichment ────────────────────────────────────────────────

export async function enrichSellerProfiles<T extends { seller_id: string }>(rows: T[]): Promise<any[]> {
  if (rows.length === 0) return [];
  const sellerIds = Array.from(new Set(rows.map((r) => r.seller_id).filter(Boolean)));
  sellerIds.push(OWNER_ID);

  const [{ data: profiles }, { data: reviewRows }, tradeOrders] = await Promise.all([
    supabaseAdmin.from('profiles').select('id, display_name, avatar_url, country, role, is_admin').in('id', sellerIds),
    supabaseAdmin.from('user_reviews').select('reviewee_id, rating').eq('direction', 'buyer_to_seller').in('reviewee_id', sellerIds),
    loadTradeOrders(),
  ]);

  const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));
  const ratingsMap = new Map<string, { total: number; count: number }>();
  (reviewRows || []).forEach((r: any) => {
    const cur = ratingsMap.get(r.reviewee_id) || { total: 0, count: 0 };
    cur.total += Number(r.rating);
    cur.count += 1;
    ratingsMap.set(r.reviewee_id, cur);
  });

  const salesCountMap = new Map<string, number>();
  (tradeOrders || []).forEach((ord) => {
    if (ord.status !== 'Cancelled' && ord.seller_id) {
      salesCountMap.set(ord.seller_id, (salesCountMap.get(ord.seller_id) || 0) + 1);
    }
  });

  return rows.map((row) => {
    const prof = profileMap.get(row.seller_id);
    const ratingInfo = ratingsMap.get(row.seller_id);
    const avgRating = ratingInfo && ratingInfo.count > 0 ? ratingInfo.total / ratingInfo.count : null;
    const reviewCount = ratingInfo ? ratingInfo.count : 0;
    const salesCount = salesCountMap.get(row.seller_id) || 0;
    const isOwner = row.seller_id === OWNER_ID || prof?.role === 'owner';
    const tier = getSellerTier(salesCount, avgRating, isOwner);

    return {
      ...row,
      seller_name: prof?.display_name || (isOwner ? 'Noel :3' : 'Community Seller'),
      seller_avatar: prof?.avatar_url || null,
      seller_country: ((prof?.country as string) || 'HU').toUpperCase(),
      seller_role: isOwner ? 'owner' : (prof?.role || (prof?.is_admin ? 'admin' : 'user')),
      seller_rating_avg: avgRating,
      seller_rating_count: reviewCount,
      seller_tier: tier.tier,
    };
  });
}

// ─── BULK LISTINGS CRUD ───────────────────────────────────────────────────────

export async function loadAllBulkListings(): Promise<MarketplaceBulkListing[]> {
  const { data, error } = await supabaseAdmin
    .from('marketplace_bulk_listings')
    .select('*')
    .order('created_at', { ascending: false });

  const settingsList = await readSettingsArray<MarketplaceBulkListing>(BULK_SETTINGS_KEY);

  if (!error && Array.isArray(data)) {
    const byId = new Map<string, MarketplaceBulkListing>();
    settingsList.forEach((item) => { if (item?.id) byId.set(item.id, item); });
    data.forEach((item: any) => {
      byId.set(item.id, {
        ...item,
        images: Array.isArray(item.images) ? item.images : [],
        handover_methods: Array.isArray(item.handover_methods) ? item.handover_methods : ['personal', 'foxpost', 'packeta', 'other'],
      });
    });
    return Array.from(byId.values()).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  return settingsList.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

export async function saveBulkListing(listing: MarketplaceBulkListing): Promise<MarketplaceBulkListing> {
  const dbRow = {
    id: listing.id,
    seller_id: listing.seller_id,
    title: listing.title,
    game: listing.game,
    exact_card_count: listing.exact_card_count,
    approx_card_count: listing.approx_card_count,
    condition: listing.condition,
    includes_foil: listing.includes_foil,
    price_huf: listing.price_huf,
    handover_methods: listing.handover_methods,
    description: listing.description || null,
    images: listing.images,
    status: listing.status,
    likes_count: listing.likes_count || 0,
    views: listing.views || 0,
    created_at: listing.created_at,
    updated_at: listing.updated_at,
  };

  let merged = { ...listing };

  try {
    const { data, error } = await supabaseAdmin
      .from('marketplace_bulk_listings')
      .upsert(dbRow)
      .select()
      .maybeSingle();

    if (!error && data) {
      merged = { ...listing, ...data };
    }
  } catch (e) {
    console.warn('saveBulkListing DB error (falling back to JSON store):', e);
  }

  const current = await readSettingsArray<MarketplaceBulkListing>(BULK_SETTINGS_KEY);
  const idx = current.findIndex((i) => i.id === merged.id);
  if (idx >= 0) current[idx] = merged;
  else current.unshift(merged);
  await writeSettingsArray(BULK_SETTINGS_KEY, current);

  return merged;
}

export async function deleteBulkListingById(id: string): Promise<void> {
  try {
    await supabaseAdmin.from('marketplace_bulk_listings').delete().eq('id', id);
  } catch {}
  const current = await readSettingsArray<MarketplaceBulkListing>(BULK_SETTINGS_KEY);
  await writeSettingsArray(BULK_SETTINGS_KEY, current.filter((i) => i.id !== id));
}

// ─── AUCTIONS CRUD & LIFECYCLE ────────────────────────────────────────────────

export async function loadAllAuctions(): Promise<MarketplaceAuction[]> {
  const { data, error } = await supabaseAdmin
    .from('marketplace_auctions')
    .select('*')
    .order('created_at', { ascending: false });

  const settingsList = await readSettingsArray<MarketplaceAuction>(AUCTIONS_SETTINGS_KEY);

  let mergedList: MarketplaceAuction[] = [];
  if (!error && Array.isArray(data)) {
    const byId = new Map<string, MarketplaceAuction>();
    settingsList.forEach((item) => { if (item?.id) byId.set(item.id, item); });
    data.forEach((item: any) => {
      byId.set(item.id, {
        ...item,
        images: Array.isArray(item.images) ? item.images : [],
        bids: Array.isArray(item.bids) ? item.bids : [],
        handover_methods: Array.isArray(item.handover_methods) ? item.handover_methods : ['personal', 'foxpost', 'packeta', 'other'],
      });
    });
    mergedList = Array.from(byId.values());
  } else {
    mergedList = settingsList;
  }

  // Enrich with catalog card info if card_id is set
  const cardIds = Array.from(new Set(mergedList.map((a) => a.card_id).filter(Boolean))) as string[];
  if (cardIds.length > 0) {
    const { data: cards } = await supabaseAdmin
      .from('cards')
      .select('*, sets(id, name, code)')
      .in('id', cardIds);
    const cardMap = new Map((cards || []).map((c: any) => [c.id, c]));
    mergedList = mergedList.map((a) => ({
      ...a,
      card: a.card_id ? cardMap.get(a.card_id) || a.card || null : null,
    }));
  }

  // Parse bulk card count from description if is_bulk was not explicitly stored
  mergedList = mergedList.map((a) => {
    let exact = a.exact_card_count;
    let approx = a.approx_card_count;
    let isBulk = Boolean(a.is_bulk || exact || approx);
    if (!isBulk && a.description) {
      const match = a.description.match(/Lot Card Count:\s*(~?\d+)\s*cards?(?:\s*\((exact|approx)\))?/i);
      if (match) {
        isBulk = true;
        const numStr = match[1].replace('~', '');
        const num = parseInt(numStr, 10);
        if (match[1].startsWith('~') || match[2]?.toLowerCase() === 'approx') {
          approx = num;
        } else {
          exact = num;
        }
      }
    }
    return {
      ...a,
      exact_card_count: exact ?? null,
      approx_card_count: approx ?? null,
      is_bulk: isBulk,
    };
  });

  return mergedList.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

export async function saveAuction(auction: MarketplaceAuction): Promise<MarketplaceAuction> {
  const dbRow = {
    id: auction.id,
    seller_id: auction.seller_id,
    card_id: auction.card_id || null,
    title: auction.title,
    game: auction.game,
    condition: auction.condition,
    is_foil: Boolean(auction.is_foil),
    quantity: auction.quantity || 1,
    images: auction.images || [],
    base_price_huf: auction.base_price_huf,
    bid_step_huf: auction.bid_step_huf,
    current_bid_huf: auction.current_bid_huf,
    bid_count: auction.bid_count || 0,
    highest_bidder_id: auction.highest_bidder_id || null,
    highest_bidder_name: auction.highest_bidder_name || null,
    extension_minutes: auction.extension_minutes ?? 5,
    starts_at: auction.starts_at,
    ends_at: auction.ends_at,
    handover_methods: auction.handover_methods || ['personal', 'foxpost', 'packeta', 'other'],
    description: auction.description || null,
    status: auction.status,
    conversation_id: auction.conversation_id || null,
    hold_request_id: auction.hold_request_id || null,
    likes_count: auction.likes_count || 0,
    views: auction.views || 0,
    bids: auction.bids || [],
    created_at: auction.created_at,
    updated_at: auction.updated_at,
  };

  try {
    await supabaseAdmin.from('marketplace_auctions').upsert(dbRow);
  } catch {}

  const current = await readSettingsArray<MarketplaceAuction>(AUCTIONS_SETTINGS_KEY);
  const idx = current.findIndex((i) => i.id === auction.id);
  if (idx >= 0) current[idx] = auction;
  else current.unshift(auction);
  await writeSettingsArray(AUCTIONS_SETTINGS_KEY, current);

  return auction;
}

export async function deleteAuctionById(id: string): Promise<void> {
  try {
    await supabaseAdmin.from('marketplace_auctions').delete().eq('id', id);
  } catch {}
  const current = await readSettingsArray<MarketplaceAuction>(AUCTIONS_SETTINGS_KEY);
  await writeSettingsArray(AUCTIONS_SETTINGS_KEY, current.filter((i) => i.id !== id));
}

/**
 * Checks all active auctions whose end date has passed and finalizes them:
 * - If there is a winning bidder, creates a conversation, sends the winning notification message,
 *   and opens a hold request so both parties can complete the handover in /messages.
 * - If there are no bids, marks the auction as 'expired'.
 */
export async function finalizeExpiredAuctions(): Promise<void> {
  const auctions = await loadAllAuctions();
  const now = Date.now();
  const nowIso = new Date().toISOString();

  for (const auction of auctions) {
    if (auction.status !== 'active') continue;
    const endsAtMs = new Date(auction.ends_at).getTime();
    if (isNaN(endsAtMs) || endsAtMs > now) continue;

    if (auction.highest_bidder_id && (auction.bid_count > 0 || auction.current_bid_huf)) {
      const winPrice = auction.current_bid_huf || auction.base_price_huf;
      const convId = await getOrCreateConversation(auction.highest_bidder_id, auction.seller_id);

      const { data: winnerProfile } = await supabaseAdmin
        .from('profiles')
        .select('display_name')
        .eq('id', auction.highest_bidder_id)
        .maybeSingle();
      const winnerName = winnerProfile?.display_name || auction.highest_bidder_name || 'Winner';

      let holdId = auction.hold_request_id || null;

      if (convId) {
        const msgText = `[Auction Won] ${auction.title} — Winning bid: ${winPrice.toLocaleString('hu-HU')} Ft`;
        await postUserMessage(convId, auction.highest_bidder_id, msgText);

        const handover = Array.isArray(auction.handover_methods) && auction.handover_methods[0]
          ? auction.handover_methods[0]
          : 'personal';

        const holdPayload = {
          inventory_id: auction.id,
          seller_id: auction.seller_id,
          buyer_id: auction.highest_bidder_id,
          buyer_name: winnerName,
          buyer_email: '',
          preferred_handover: handover,
          status: 'held',
          card_name: `[Auction] ${auction.title}`,
          card_number: 'AUCTION',
          price_huf: winPrice,
          quantity: auction.quantity || 1,
          conversation_id: convId,
          message: msgText,
          items: [{
            inventory_id: auction.id,
            card_name: `[Auction] ${auction.title}`,
            quantity: auction.quantity || 1,
            price_huf: winPrice,
            is_auction: true,
          }],
          created_at: nowIso,
          updated_at: nowIso,
        };

        const { data: insertedHold } = await supabaseAdmin
          .from('hold_requests')
          .insert(holdPayload)
          .select('id')
          .maybeSingle();
        if (insertedHold?.id) holdId = insertedHold.id;
      }

      auction.status = 'ended';
      auction.conversation_id = convId;
      auction.hold_request_id = holdId;
      auction.updated_at = nowIso;
      await saveAuction(auction);
    } else {
      auction.status = 'expired';
      auction.updated_at = nowIso;
      await saveAuction(auction);
    }
  }
}

/**
 * Cancels an auction with a winning bid on behalf of the seller and records a mandatory 1-star
 * system review on the seller's profile stating they cancelled / did not honor the auction price.
 */
export async function applyAuctionSellerCancelPenalty(
  auctionId: string,
  sellerId: string
): Promise<{ success: boolean; penaltyApplied: boolean; error?: string }> {
  const auctions = await loadAllAuctions();
  const auction = auctions.find((a) => a.id === auctionId);
  if (!auction) {
    return { success: false, penaltyApplied: false, error: 'Auction not found.' };
  }
  if (auction.seller_id !== sellerId && sellerId !== OWNER_ID) {
    return { success: false, penaltyApplied: false, error: 'Forbidden.' };
  }

  const nowIso = new Date().toISOString();
  const hasWinner = Boolean(auction.highest_bidder_id && (auction.bid_count > 0 || auction.current_bid_huf));

  auction.status = 'cancelled';
  auction.updated_at = nowIso;
  await saveAuction(auction);

  // Cancel any open hold request associated with this auction
  try {
    await supabaseAdmin
      .from('hold_requests')
      .update({ status: 'cancelled', updated_at: nowIso })
      .eq('inventory_id', auctionId)
      .in('status', ['pending', 'held', 'handed_over', 'buyer_received']);
  } catch {}

  if (!hasWinner) {
    return { success: true, penaltyApplied: false };
  }

  // Ensure conversation & notify the winning bidder
  const convId = auction.conversation_id || (await getOrCreateConversation(auction.highest_bidder_id!, auction.seller_id));
  if (convId) {
    await postSystemMessage(
      convId,
      auction.seller_id,
      `Auction cancelled by seller ("${auction.title}"). Because the seller did not honor the winning bid of ${(auction.current_bid_huf || auction.base_price_huf).toLocaleString('hu-HU')} Ft, an automatic 1-star system review has been recorded on the seller's profile.`
    );
  }

  // Insert mandatory 1-star system review on the seller's profile
  const orderNumber = `AUC-${auction.id.slice(0, 8).toUpperCase()}`;
  const reviewRow = {
    order_number: orderNumber,
    reviewer_id: auction.highest_bidder_id!,
    reviewee_id: auction.seller_id,
    direction: 'buyer_to_seller' as const,
    rating: 1,
    scores: {
      communication: 1,
      packaging: 1,
      speed: 1,
      item_as_described: 1,
    },
    comment: `System Penalty Review: Seller cancelled completed auction "${auction.title}" and refused to honor the winning bid price of ${(auction.current_bid_huf || auction.base_price_huf).toLocaleString('hu-HU')} Ft.`,
    reviewer_name: 'TCG XChange System',
    reviewer_avatar: null,
    created_at: nowIso,
  };

  try {
    await supabaseAdmin
      .from('user_reviews')
      .upsert(reviewRow, { onConflict: 'order_number,reviewer_id' });
  } catch (e) {
    console.warn('Could not insert auction penalty review into user_reviews:', e);
  }

  return { success: true, penaltyApplied: true };
}
