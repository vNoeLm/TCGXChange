import { supabase } from './supabase';
import { sanitizePostgrestFilterTerm } from './sanitize';
import type { GenericCartItem } from './genericCart';

export interface P2PCardInfo {
  id: string;
  name: string;
  card_number: string;
  rarity: string;
  game: string;
  image_path: string | null;
  market_price_eur?: number | null;
  market_price_foil_eur?: number | null;
  set_id?: string;
  sets?: {
    id?: string;
    code?: string;
    name?: string;
  } | null;
}

export interface P2PSellerInfo {
  id: string;
  display_name: string;
  avatar_url: string | null;
  country: string;
  rating_avg: number;
  rating_count: number;
}

export interface P2PListing {
  id: string;
  seller_id: string;
  card_id: string;
  condition: string;
  is_foil: boolean;
  price_huf: number;
  quantity: number;
  status: string;
  description: string | null;
  images: string[];
  likes_count: number;
  liked_by_me: boolean;
  created_at: string;
  updated_at: string;
  card: P2PCardInfo;
  seller: P2PSellerInfo;
}

export interface P2PCardGroup {
  key: string;
  card_id: string;
  is_foil: boolean;
  card: P2PCardInfo;
  lowest_price_huf: number;
  highest_price_huf: number;
  total_quantity: number;
  offer_count: number;
  sellers_count: number;
  offers: P2PListing[];
}

export interface P2PPostTaggedCard {
  id: string;
  post_id: string;
  card_id: string;
  is_highlight_only: boolean;
  condition: string;
  is_foil: boolean;
  price_huf: number | null;
  quantity: number;
  held_quantity: number;
  available_quantity: number;
  status: 'available' | 'held' | 'sold';
  card: P2PCardInfo;
}

export interface P2PPost {
  id: string;
  seller_id: string;
  post_type: 'photo_post' | 'bulk';
  title: string | null;
  body: string;
  lot_price_huf: number | null;
  images: string[];
  status: 'open' | 'held' | 'sold_out' | 'closed';
  likes_count: number;
  liked_by_me: boolean;
  created_at: string;
  updated_at: string;
  tagged_cards: P2PPostTaggedCard[];
  seller: P2PSellerInfo;
}

export interface P2PHoldRequest {
  id: string;
  seller_id: string;
  buyer_id: string | null;
  buyer_name: string;
  preferred_handover: string;
  message: string | null;
  status: 'pending' | 'accepted' | 'declined' | 'released' | 'cancelled' | 'handed_over' | 'completed' | 'expired';
  listing_id: string | null;
  post_id: string | null;
  conversation_id: string | null;
  order_number: string | null;
  card_name: string | null;
  card_number: string | null;
  image_path: string | null;
  price_huf: number | null;
  is_foil: boolean | null;
  condition: string | null;
  quantity: number;
  items: any[] | null;
  expires_at: string | null;
  handed_over_at: string | null;
  created_at: string;
  updated_at: string;
  my_review_submitted?: boolean;
}

export async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function p2pFetch<T = any>(url: string, init: RequestInit = {}): Promise<T> {
  const authHeaders = await getAuthHeaders();
  const headers: Record<string, string> = {
    ...authHeaders,
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.body && !(init.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, { ...init, headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || `Request failed (${res.status})`);
  }
  return json as T;
}

export async function fetchListings(params: Record<string, string | undefined>): Promise<{
  listings: P2PListing[];
  cards: P2PCardGroup[];
  schemaReady: boolean;
}> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') qs.set(k, v);
  }
  return p2pFetch(`/api/marketplace/listings?${qs.toString()}`);
}

export async function fetchPosts(params: Record<string, string | undefined>): Promise<{
  posts: P2PPost[];
  schemaReady: boolean;
}> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') qs.set(k, v);
  }
  return p2pFetch(`/api/marketplace/posts?${qs.toString()}`);
}

export async function uploadMarketplacePhotos(files: File[]): Promise<string[]> {
  const form = new FormData();
  files.forEach((f) => form.append('files', f));
  const res = await p2pFetch<{ urls: string[] }>('/api/marketplace/upload-image', {
    method: 'POST',
    body: form,
  });
  return res.urls || [];
}

export async function toggleLike(target: { listing_id?: string; post_id?: string }): Promise<{
  liked: boolean;
  likes_count: number;
}> {
  return p2pFetch('/api/marketplace/like', {
    method: 'POST',
    body: JSON.stringify(target),
  });
}

export async function createSingleListing(payload: {
  card_id: string;
  price_huf: number;
  quantity: number;
  condition: string;
  is_foil: boolean;
  description?: string;
  images?: string[];
}) {
  return p2pFetch('/api/marketplace/listings', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateListing(payload: Record<string, any>) {
  return p2pFetch('/api/marketplace/listings', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deleteListing(id: string) {
  return p2pFetch(`/api/marketplace/listings?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function createMarketplacePost(payload: {
  post_type: 'photo_post' | 'bulk';
  title?: string;
  body: string;
  lot_price_huf?: number | null;
  images: string[];
  tagged_cards: Array<{
    card_id: string;
    is_highlight_only: boolean;
    condition: string;
    is_foil: boolean;
    price_huf: number | null;
    quantity: number;
  }>;
}) {
  return p2pFetch('/api/marketplace/posts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateMarketplacePost(payload: Record<string, any>) {
  return p2pFetch('/api/marketplace/posts', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deleteMarketplacePost(id: string) {
  return p2pFetch(`/api/marketplace/posts?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function createHoldRequest(payload: {
  mode: 'listing' | 'listings_batch' | 'post_card' | 'bulk_lot';
  listing_id?: string;
  post_id?: string;
  post_card_id?: string;
  quantity?: number;
  items?: Array<{ listing_id?: string; post_card_id?: string; quantity: number }>;
  note?: string;
}): Promise<{ hold: P2PHoldRequest; conversation_id: string }> {
  return p2pFetch('/api/marketplace/hold-requests', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchConversationHolds(conversationId?: string): Promise<P2PHoldRequest[]> {
  const qs = conversationId ? `?conversation_id=${encodeURIComponent(conversationId)}` : '';
  const res = await p2pFetch<{ holds: P2PHoldRequest[] }>(`/api/marketplace/hold-requests${qs}`);
  return res.holds || [];
}

export async function updateHoldStatus(
  hold_request_id: string,
  action: 'accept' | 'decline' | 'release' | 'cancel' | 'hand_over' | 'confirm_received'
): Promise<{ status: string }> {
  return p2pFetch('/api/marketplace/hold-requests', {
    method: 'PATCH',
    body: JSON.stringify({ hold_request_id, action }),
  });
}

export async function startP2PConversation(
  seller_id: string,
  message?: string
): Promise<{ conversation_id: string }> {
  return p2pFetch('/api/marketplace/chat', {
    method: 'POST',
    body: JSON.stringify({ seller_id, message }),
  });
}

export async function submitP2PReview(
  hold_request_id: string,
  scores: Record<string, number>,
  comment?: string
) {
  return p2pFetch('/api/reviews/submit', {
    method: 'POST',
    body: JSON.stringify({ hold_request_id, scores, comment }),
  });
}

export async function searchCatalogCards(query: string, game?: string): Promise<P2PCardInfo[]> {
  const clean = sanitizePostgrestFilterTerm(query, 60);
  if (clean.length < 2) return [];

  let q = supabase
    .from('cards')
    .select('id, name, card_number, rarity, game, image_path, market_price_eur, market_price_foil_eur, set_id, sets(id, code, name)')
    .eq('is_archived', false)
    .is('deleted_at', null)
    .or(`name.ilike.%${clean}%,card_number.ilike.%${clean}%`)
    .order('card_number', { ascending: true })
    .limit(12);

  if (game) {
    q = q.eq('game', game);
  }

  const { data } = await q;
  return (data || []).map((r: any) => ({
    ...r,
    sets: Array.isArray(r.sets) ? r.sets[0] : r.sets,
  }));
}

export interface P2PCartEntry {
  listingId: string;
  quantity: number;
  listing: P2PListing;
}

const P2P_CART_KEY = 'tcg_p2p_hold_cart_v1';

export function loadP2PCart(): P2PCartEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(P2P_CART_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((e) => e?.listingId && e?.listing) : [];
  } catch {
    return [];
  }
}

export function saveP2PCart(entries: P2PCartEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(P2P_CART_KEY, JSON.stringify(entries));
  } catch {}
}

export function p2pCartEntryToGeneric(entry: P2PCartEntry): GenericCartItem {
  const l = entry.listing;
  return {
    id: l.id,
    name: l.card.name,
    priceHuf: l.price_huf,
    quantity: entry.quantity,
    maxQuantity: Math.max(1, l.quantity),
    image: l.images?.[0] || null,
    imagePath: l.images?.[0] ? null : l.card.image_path,
    subtitle: `${l.card.card_number}${l.is_foil ? ' · Foil' : ''} · ${l.condition}`,
    sellerId: l.seller_id,
    sellerName: l.seller.display_name,
    sellerCountry: l.seller.country,
    condition: l.condition,
    isFoil: l.is_foil,
    cardNumber: l.card.card_number,
  };
}
