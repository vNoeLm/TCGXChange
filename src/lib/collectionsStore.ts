import { useEffect, useSyncExternalStore } from 'react';
import { supabase } from './supabase';
import { getCurrentUser, onSignedInUserChange } from './auth';
import {
  DEFAULT_PERSONAL_SETTINGS,
  PERSONAL_COLLECTION_ID,
  PERSONAL_SETTINGS_STORAGE_KEY,
  type ListDefaults,
  type NamedCollection,
  type PersonalCollectionSettings,
} from './collectionDefaults';

/**
 * The browser's view of the user's named collections and which collection is active - shared by
 * the Catalog, the card window and the Binder, so a +1 in one shows in the others.
 *
 * "personal" (the original collection) is not in here: it keeps living in the browser with its own
 * sync (CardListApp). Named collections live on the server; changes are applied here straight away
 * and sent in small batches (a burst of +1 clicks becomes one request).
 */

const ACTIVE_KEY = 'tcg_active_collection';

export function readPersonalSettings(): PersonalCollectionSettings {
  if (typeof window === 'undefined') return DEFAULT_PERSONAL_SETTINGS;
  try {
    const raw = localStorage.getItem(PERSONAL_SETTINGS_STORAGE_KEY);
    return raw ? { ...DEFAULT_PERSONAL_SETTINGS, ...JSON.parse(raw) } : DEFAULT_PERSONAL_SETTINGS;
  } catch {
    return DEFAULT_PERSONAL_SETTINGS;
  }
}

interface State {
  userId: string | null;
  status: 'signed-out' | 'loading' | 'ready' | 'error';
  collections: NamedCollection[];
  personalSettings: PersonalCollectionSettings;
  activeId: string;
  /** The database update for named collections hasn't been run yet. */
  needsMigration: boolean;
}

let state: State = {
  userId: null,
  status: 'signed-out',
  collections: [],
  personalSettings: readPersonalSettings(),
  activeId: PERSONAL_COLLECTION_ID,
  needsMigration: false,
};
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const set = (patch: Partial<State>) => { state = { ...state, ...patch }; emit(); };

function readStoredActive(userId: string): string {
  try {
    const raw = localStorage.getItem(ACTIVE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && parsed.userId === userId && typeof parsed.id === 'string' ? parsed.id : PERSONAL_COLLECTION_ID;
  } catch {
    return PERSONAL_COLLECTION_ID;
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...init, headers: { ...(await authHeaders()), ...(init.headers || {}) } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) throw new Error(json.error || 'Something went wrong - try again.');
  return json as T;
}

let started = false;
async function loadFor(userId: string | null) {
  if (!userId) {
    set({ userId: null, status: 'signed-out', collections: [], personalSettings: readPersonalSettings(), activeId: PERSONAL_COLLECTION_ID });
    return;
  }
  set({ userId, status: 'loading' });
  try {
    const json = await api<{ collections: NamedCollection[]; personal?: PersonalCollectionSettings | null; needs_migration?: boolean }>('/api/collections');
    const stored = readStoredActive(userId);
    const activeId = json.collections.some((c) => c.id === stored) ? stored : PERSONAL_COLLECTION_ID;
    let personalSettings = readPersonalSettings();
    if (json.personal) {
      personalSettings = { ...personalSettings, ...json.personal };
      try { localStorage.setItem(PERSONAL_SETTINGS_STORAGE_KEY, JSON.stringify(personalSettings)); } catch {}
    }
    set({ status: 'ready', collections: json.collections, personalSettings, activeId, needsMigration: Boolean(json.needs_migration) });
  } catch {
    set({ status: 'error', collections: [], activeId: PERSONAL_COLLECTION_ID });
  }
}

export async function savePersonalSettings(settings: Partial<PersonalCollectionSettings>): Promise<PersonalCollectionSettings> {
  const current = state.personalSettings || readPersonalSettings();
  const next: PersonalCollectionSettings = {
    ...current,
    ...settings,
    name: settings.name !== undefined ? (settings.name.trim() || 'Personal') : current.name,
  };
  try { localStorage.setItem(PERSONAL_SETTINGS_STORAGE_KEY, JSON.stringify(next)); } catch {}
  set({ personalSettings: next });

  if (state.userId) {
    try {
      const res = await api<{ success: boolean; personal: PersonalCollectionSettings }>('/api/collections/personal', {
        method: 'PATCH',
        body: JSON.stringify(next),
      });
      if (res?.personal) {
        set({ personalSettings: res.personal });
        try { localStorage.setItem(PERSONAL_SETTINGS_STORAGE_KEY, JSON.stringify(res.personal)); } catch {}
      }
    } catch (e) {
      console.warn('Failed to sync personal collection settings to cloud:', e);
    }
  }
  return next;
}

function start() {
  if (started || typeof window === 'undefined') return;
  started = true;
  getCurrentUser().then((u) => loadFor(u?.id ?? null));
  onSignedInUserChange((session) => loadFor(session?.user?.id ?? null));
}

export function useCollectionsStore(): State {
  useEffect(start, []);
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state, () => state);
}

export const getCollectionsState = () => state;

/** The named collection that's active, or null when Personal is. */
export function activeNamedCollection(s: State = state): NamedCollection | null {
  return s.activeId === PERSONAL_COLLECTION_ID ? null : s.collections.find((c) => c.id === s.activeId) || null;
}

export function setActiveCollection(id: string) {
  if (!state.userId) return;
  const activeId = id === PERSONAL_COLLECTION_ID || state.collections.some((c) => c.id === id) ? id : PERSONAL_COLLECTION_ID;
  try { localStorage.setItem(ACTIVE_KEY, JSON.stringify({ userId: state.userId, id: activeId })); } catch {}
  set({ activeId });
}

const replaceCollection = (c: NamedCollection) =>
  set({ collections: state.collections.map((x) => (x.id === c.id ? c : x)) });

export async function createCollection(
  name: string,
  alwaysList = false,
  listDefaults?: ListDefaults,
  isPublic = false
): Promise<NamedCollection> {
  const json = await api<{ collection: NamedCollection }>('/api/collections', {
    method: 'POST',
    body: JSON.stringify({ name, always_list: alwaysList, list_defaults: listDefaults, is_public: isPublic }),
  });
  set({ collections: [...state.collections, json.collection] });
  return json.collection;
}

export async function updateCollection(
  id: string,
  patch: { name?: string; always_list?: boolean; list_defaults?: ListDefaults; is_public?: boolean; recalculate_prices?: boolean },
  prices?: Record<string, number>
): Promise<{ collection: NamedCollection; sync?: { listed: number; cardsListed: number; skippedUnpriced: number } | null }> {
  await flushPending(id);
  const json = await api<{ collection: NamedCollection; sync?: { listed: number; cardsListed: number; skippedUnpriced: number } | null }>('/api/collections', {
    method: 'PATCH',
    body: JSON.stringify({ id, ...patch, prices }),
  });
  replaceCollection(json.collection);
  return { collection: json.collection, sync: json.sync };
}

export async function recalculateCollectionPrices(
  id: string,
  prices: Record<string, number>
): Promise<{ collection: NamedCollection; sync?: { listed: number; cardsListed: number; skippedUnpriced: number } | null }> {
  return updateCollection(id, { recalculate_prices: true }, prices);
}

export async function deleteCollection(id: string): Promise<void> {
  await api(`/api/collections?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  const collections = state.collections.filter((c) => c.id !== id);
  set({ collections, activeId: state.activeId === id ? PERSONAL_COLLECTION_ID : state.activeId });
  if (state.activeId === PERSONAL_COLLECTION_ID) setActiveCollection(PERSONAL_COLLECTION_ID);
}

/** Re-reads one collection from the server (after something else changed it, e.g. a listing edit). */
export async function refreshCollections(): Promise<void> {
  await loadFor(state.userId);
}

// ── Count changes: applied here at once, sent in batches ──

type Pending = { deltas: Record<string, number>; prices: Record<string, number>; timer: ReturnType<typeof setTimeout> | null };
const pending = new Map<string, Pending>();
const inFlight = new Map<string, Promise<boolean>>();
const errorListeners = new Set<(msg: string) => void>();

/** Hear about a change the server refused or clamped (e.g. copies a buyer is holding). */
export function onCollectionsMessage(fn: (msg: string) => void): () => void {
  errorListeners.add(fn);
  return () => errorListeners.delete(fn);
}
const tell = (msg: string) => errorListeners.forEach((fn) => fn(msg));

function applyLocally(id: string, change: (cards: Record<string, number>) => Record<string, number>) {
  const coll = state.collections.find((c) => c.id === id);
  if (coll) replaceCollection({ ...coll, cards: change({ ...coll.cards }) });
}

/**
 * +n / -n copies of one card (key: "<card id>" or "<card id>_foil"). `price` is what the card lists
 * at if the collection is always-list and this adds it to the market (0 when skip_unpriced skips it).
 */
export function changeCollectionCard(id: string, key: string, delta: number, price?: number | null) {
  if (!delta) return;
  applyLocally(id, (cards) => {
    const after = Math.max(0, Math.min(9999, (cards[key] || 0) + delta));
    if (after === 0) delete cards[key];
    else cards[key] = after;
    return cards;
  });
  const p = pending.get(id) || { deltas: {}, prices: {}, timer: null };
  p.deltas[key] = (p.deltas[key] || 0) + delta;
  const cardId = key.replace(/_foil$/, '');
  if (price !== undefined && price !== null && price >= 0) {
    p.prices[key] = price;
    if (!(cardId in p.prices) || !key.endsWith('_foil')) p.prices[cardId] = price;
  }
  if (p.timer) clearTimeout(p.timer);
  p.timer = setTimeout(() => { void flushPending(id); }, 500);
  pending.set(id, p);
}

/** Replaces every count in a collection (import, clear, moving cards). Resolves false if the server refused. */
export async function setCollectionCards(id: string, cards: Record<string, number>, prices: Record<string, number> = {}): Promise<boolean> {
  await flushPending(id);
  applyLocally(id, () => ({ ...cards }));
  return send(id, { set: cards, prices });
}

async function flushPending(id: string): Promise<void> {
  const prior = inFlight.get(id);
  if (prior) await prior;
  const p = pending.get(id);
  if (!p) return;
  if (p.timer) clearTimeout(p.timer);
  pending.delete(id);
  const deltas = Object.fromEntries(Object.entries(p.deltas).filter(([, d]) => d !== 0));
  if (Object.keys(deltas).length === 0) return;
  await send(id, { deltas, prices: p.prices });
}

function send(id: string, payload: { deltas?: Record<string, number>; set?: Record<string, number>; prices: Record<string, number> }): Promise<boolean> {
  const run = (async (): Promise<boolean> => {
    try {
      const json = await api<{ collection: NamedCollection; clamped: Record<string, number> }>('/api/collections/cards', {
        method: 'POST',
        body: JSON.stringify({ id, ...payload }),
      });
      // Changes made while this was on its way stay on top of what the server sent back.
      const later = pending.get(id)?.deltas || {};
      const cards = { ...json.collection.cards };
      for (const [key, d] of Object.entries(later)) {
        const after = Math.max(0, (cards[key] || 0) + d);
        if (after === 0) delete cards[key];
        else cards[key] = after;
      }
      replaceCollection({ ...json.collection, cards });
      const clampedCount = Object.keys(json.clamped || {}).length;
      if (clampedCount) tell(`${clampedCount === 1 ? 'A card' : `${clampedCount} cards`} couldn't go lower - buyers are holding those copies.`);
      return true;
    } catch (e: any) {
      tell(e?.message || 'Could not save the change - reloading the collection.');
      await loadFor(state.userId);
      return false;
    } finally {
      inFlight.delete(id);
    }
  })();
  inFlight.set(id, run);
  return run;
}
