import { collectionKey } from './collectionDefaults';

/** When this browser's copy of the collection was last changed, or last matched the cloud. */
export const COLLECTION_STAMP_KEY = 'tcg_collection_updated_at';

/**
 * Which signed-in account this browser's saved collection currently belongs to. Signing out never
 * clears the collection (so a guest can keep tracking one, and a returning user finds theirs
 * again), which means it can still be sitting here from a *different* account the next time
 * someone signs in on this browser - a shared computer, or switching between a main and a test
 * account. Without this tag, that leftover data looks like an ordinary, newly-changed local
 * collection to the cloud sync, and once it wins the "which side is newer" comparison it overwrites
 * the new account's real cloud collection with the previous account's.
 */
export const COLLECTION_OWNER_KEY = 'tcg_collection_owner';

export function getLocalCollectionStamp(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(COLLECTION_STAMP_KEY);
  } catch {
    return null;
  }
}

export function getLocalCollectionOwner(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(COLLECTION_OWNER_KEY);
  } catch {
    return null;
  }
}

/** Records which account this browser's local collection now belongs to. */
export function setLocalCollectionOwner(userId: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(COLLECTION_OWNER_KEY, userId);
  } catch {
    // best-effort
  }
}

/**
 * This browser's saved collection (shared by every tab), or null if there is none or it can't be
 * read. Each tab also keeps a copy in memory; this is the one that is always current.
 */
export function readLocalCollection(): Record<string, number> | null {
  if (typeof window === 'undefined') return null;
  try {
    const saved = localStorage.getItem('tcg_user_collection') || localStorage.getItem('tcg_collection');
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    const dict: Record<string, number> = {};
    if (Array.isArray(parsed)) {
      parsed.forEach((id) => { if (typeof id === 'string' && id.trim()) dict[id.trim()] = 1; });
    } else if (parsed && typeof parsed === 'object') {
      Object.entries(parsed).forEach(([k, v]) => {
        const count = typeof v === 'number' ? v : parseInt(String(v), 10);
        if (count > 0) dict[k] = count;
      });
    } else {
      return null;
    }
    return dict;
  } catch {
    return null;
  }
}

// Another tab changed the collection: pass it on to everything in this tab that shows or edits it,
// marked `external` so this tab treats it as already handled (the tab that made the change saves
// it to the cloud). Without this a tab opened earlier kept its old copy in memory, and its next save
// put that old copy back over the newer one - which is how a move between collections got undone.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== 'tcg_user_collection') return;
    const collection = readLocalCollection() || {};
    window.dispatchEvent(new CustomEvent('tcg-collection-change', { detail: { collection, external: true } }));
  });
}

/**
 * The single way this browser's collection is saved.
 *
 * Every change stamps the time it was made, which is what lets the cloud sync tell a deliberate
 * change (a reset, a lowered count) from an old copy that should be replaced. Passing the cloud's
 * own time instead marks the browser as exactly in step with the cloud.
 */
export function saveLocalCollection(
  collection: Record<string, number>,
  stamp: string = new Date().toISOString(),
  notify: boolean = true
): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('tcg_user_collection', JSON.stringify(collection));
    localStorage.setItem('tcg_collection', JSON.stringify(collection));
    localStorage.setItem(COLLECTION_STAMP_KEY, stamp);
  } catch (e) {
    console.warn('Failed to save the local collection:', e);
  }
  if (notify) window.dispatchEvent(new CustomEvent('tcg-collection-change', { detail: { collection } }));
}

/**
 * Mirrors a server-side collection adjustment (see lib/collectionServer.ts) into
 * this browser's local collection cache, so the UI doesn't go stale until the
 * next full reload and the next sync doesn't undo it.
 */
export function adjustLocalCollection(cardId: string, isFoil: boolean, delta: number): void {
  if (typeof window === 'undefined' || !cardId || !delta) return;
  try {
    const raw = localStorage.getItem('tcg_user_collection') || localStorage.getItem('tcg_collection');
    const dict: Record<string, number> = raw ? JSON.parse(raw) : {};
    const key = collectionKey(cardId, isFoil);
    const next = Math.max(0, (dict[key] || 0) + delta);
    if (next === 0) delete dict[key];
    else dict[key] = next;

    saveLocalCollection(dict);
  } catch (e) {
    console.warn('Failed to sync local collection:', e);
  }
}
