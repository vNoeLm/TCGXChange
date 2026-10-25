import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { getCurrentUser, onSignedInUserChange } from './auth';

/**
 * Named lists of cards a signed-in user wants, with amounts. `items` has the same shape as the
 * collection - { "<card id>": qty, "<card id>_foil": qty } - so anything that reads a collection
 * map (Quick Shop's want-list parser included) reads a wishlist too. Stored in `wishlists`
 * (see the 20261004 migration), private to their owner.
 */
export interface Wishlist {
  id: string;
  user_id: string;
  game: string;
  name: string;
  items: Record<string, number>;
  created_at: string;
  updated_at: string;
}

export const WISHLISTS_EVENT = 'tcg-wishlists-changed';
export const MAX_WISHLIST_NAME = 60;

const wishlistOrderKey = (userId: string, game: string) => `tcg_wishlist_order_${userId}_${game}`;

function readWishlistOrder(userId: string, game: string): string[] {
  if (typeof window === 'undefined' || !userId) return [];
  try {
    const raw = localStorage.getItem(wishlistOrderKey(userId, game));
    const ids = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/** Applies the user's saved left-side list order; unknown/new lists keep their created order after it. */
export function orderWishlists(lists: Wishlist[], game: string): Wishlist[] {
  if (lists.length === 0) return lists;
  const order = readWishlistOrder(lists[0].user_id, game);
  const position = new Map(order.map((id, index) => [id, index]));
  return [...lists].sort((a, b) => {
    const ia = position.has(a.id) ? position.get(a.id)! : Number.MAX_SAFE_INTEGER;
    const ib = position.has(b.id) ? position.get(b.id)! : Number.MAX_SAFE_INTEGER;
    if (ia !== ib) return ia - ib;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });
}

/** Moves one list up (-1) or down (+1) in the saved order and returns the new order. */
export function moveWishlist(lists: Wishlist[], game: string, id: string, direction: -1 | 1): Wishlist[] {
  if (lists.length === 0) return lists;
  const ordered = orderWishlists(lists, game);
  const from = ordered.findIndex((l) => l.id === id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= ordered.length) return ordered;
  const next = [...ordered];
  [next[from], next[to]] = [next[to], next[from]];
  try {
    localStorage.setItem(wishlistOrderKey(ordered[0].user_id, game), JSON.stringify(next.map((l) => l.id)));
  } catch {}
  return next;
}

let cache: Wishlist[] | null = null;
let pending: Promise<Wishlist[]> | null = null;

function publish(lists: Wishlist[]) {
  cache = lists;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(WISHLISTS_EVENT, { detail: { lists } }));
}

if (typeof window !== 'undefined') {
  // Someone else's lists must never linger after a sign-out or account switch.
  onSignedInUserChange(() => {
    cache = null;
    pending = null;
    fetchWishlists().then(publish, () => publish([]));
  });
}

/** The signed-in user's lists, oldest first ([] when signed out). Fetched once per page and shared. */
export async function fetchWishlists(force = false): Promise<Wishlist[]> {
  if (!force && cache) return cache;
  if (!force && pending) return pending;
  const request = (async () => {
    const user = await getCurrentUser();
    if (!user) return [];
    const { data, error } = await supabase
      .from('wishlists')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data || []) as Wishlist[];
  })();
  pending = request;
  try {
    const lists = await request;
    cache = lists;
    return lists;
  } finally {
    if (pending === request) pending = null;
  }
}

async function requireUserId(): Promise<string> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Sign in to use wishlists.');
  return user.id;
}

export async function createWishlist(name: string, game: string, items: Record<string, number> = {}): Promise<Wishlist> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from('wishlists')
    .insert({ user_id: userId, game, name: name.trim().slice(0, MAX_WISHLIST_NAME), items })
    .select()
    .single();
  if (error) throw error;
  publish([...(await fetchWishlists()).filter((l) => l.id !== data.id), data as Wishlist]);
  return data as Wishlist;
}

async function updateWishlist(id: string, patch: Partial<Pick<Wishlist, 'name' | 'items'>>): Promise<Wishlist> {
  const { data, error } = await supabase
    .from('wishlists')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  publish((await fetchWishlists()).map((l) => (l.id === id ? (data as Wishlist) : l)));
  return data as Wishlist;
}

export function renameWishlist(id: string, name: string) {
  return updateWishlist(id, { name: name.trim().slice(0, MAX_WISHLIST_NAME) });
}

export async function deleteWishlist(id: string): Promise<void> {
  const { error } = await supabase.from('wishlists').delete().eq('id', id);
  if (error) throw error;
  publish((await fetchWishlists()).filter((l) => l.id !== id));
}

/** Key for one finish of a card in `items`. */
export const wishlistKey = (cardId: string, foil: boolean) => (foil ? `${cardId}_foil` : cardId);

/** Sets how many copies of one finish a list wants; 0 removes it. */
export async function setWishlistQuantity(id: string, cardId: string, foil: boolean, qty: number): Promise<Wishlist> {
  const list = (await fetchWishlists()).find((l) => l.id === id);
  if (!list) throw new Error('That wishlist no longer exists.');
  const items = { ...list.items };
  const key = wishlistKey(cardId, foil);
  if (qty > 0) items[key] = Math.min(99, Math.floor(qty));
  else delete items[key];
  return updateWishlist(id, { items });
}

/** Adds copies to a list (an imported want-list): counts add up, each capped at 99. */
export async function addWishlistItems(id: string, add: Record<string, number>): Promise<Wishlist> {
  const list = (await fetchWishlists()).find((l) => l.id === id);
  if (!list) throw new Error('That wishlist no longer exists.');
  const items = { ...list.items };
  for (const [key, qty] of Object.entries(add)) {
    if (qty > 0) items[key] = Math.min(99, (items[key] || 0) + Math.floor(qty));
  }
  return updateWishlist(id, { items });
}

/** The base card ids a list contains (either finish). */
export function wishlistCardIds(items: Record<string, number>): Set<string> {
  const ids = new Set<string>();
  for (const [key, qty] of Object.entries(items)) if (qty > 0) ids.add(key.replace(/_foil$/, ''));
  return ids;
}

export function wishlistCopies(items: Record<string, number>): number {
  return Object.values(items).reduce((sum, qty) => sum + (qty > 0 ? qty : 0), 0);
}

/**
 * A list as Quick Shop want-list lines - "2x Name (OGN-012/298) [Foil]" - readable and editable in
 * its text box, and pinned to the exact print by the card number.
 */
export function wishlistToWantText(
  items: Record<string, number>,
  cardsById: Map<string, { name: string; card_number?: string | null }>
): string {
  return Object.entries(items)
    .filter(([, qty]) => qty > 0)
    .map(([key, qty]) => {
      const foil = key.endsWith('_foil');
      const card = cardsById.get(key.replace(/_foil$/, ''));
      if (!card) return null;
      return `${qty}x ${card.name}${card.card_number ? ` (${card.card_number})` : ''}${foil ? ' [Foil]' : ''}`;
    })
    .filter(Boolean)
    .join('\n');
}

/** The cards a list refers to (anything the wishlist page or a want-list needs to show them). */
export interface WishlistCard {
  id: string;
  name: string;
  card_number: string | null;
  image_path: string | null;
  rarity: string | null;
  game: string | null;
  market_price_eur: number | null;
  market_price_foil_eur: number | null;
}

export async function fetchWishlistCards(items: Record<string, number>): Promise<Map<string, WishlistCard>> {
  const ids = [...wishlistCardIds(items)];
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase
    .from('cards')
    .select('id, name, card_number, image_path, rarity, game, market_price_eur, market_price_foil_eur')
    .in('id', ids);
  if (error) throw error;
  return new Map((data || []).map((c: any) => [c.id, c as WishlistCard]));
}

/** A list as Quick Shop want-list text (see wishlistToWantText). */
export async function wishlistWantText(list: Wishlist): Promise<string> {
  return wishlistToWantText(list.items, await fetchWishlistCards(list.items));
}

export interface WishlistsState {
  lists: Wishlist[];
  loading: boolean;
  /** Set when lists can't be loaded at all - e.g. the wishlists table hasn't been created yet. */
  error: string | null;
}

/** The signed-in user's lists, kept current as they change anywhere on the page. */
export function useWishlists(): WishlistsState {
  const [state, setState] = useState<WishlistsState>({ lists: cache || [], loading: cache === null, error: null });
  useEffect(() => {
    let alive = true;
    fetchWishlists().then(
      (lists) => alive && setState({ lists, loading: false, error: null }),
      (err) => alive && setState({ lists: [], loading: false, error: err?.message || 'Could not load wishlists.' })
    );
    const onChange = (e: Event) => {
      const lists = (e as CustomEvent).detail?.lists;
      if (Array.isArray(lists)) setState({ lists, loading: false, error: null });
    };
    window.addEventListener(WISHLISTS_EVENT, onChange);
    return () => {
      alive = false;
      window.removeEventListener(WISHLISTS_EVENT, onChange);
    };
  }, []);
  return state;
}
