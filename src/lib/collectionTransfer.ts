import { PERSONAL_COLLECTION_ID, type ListDefaults, type NamedCollection } from './collectionDefaults';
import { setCollectionCards } from './collectionsStore';

export interface CollectionOption {
  id: string;
  name: string;
}

export function getCollectionOptions(named: NamedCollection[]): CollectionOption[] {
  return [
    { id: PERSONAL_COLLECTION_ID, name: 'Personal' },
    ...named.map((c) => ({ id: c.id, name: c.name })),
  ];
}

export function getCardsOfCollection(
  id: string,
  personalCards: Record<string, number>,
  named: NamedCollection[]
): Record<string, number> {
  return id === PERSONAL_COLLECTION_ID ? personalCards : named.find((c) => c.id === id)?.cards || {};
}

export function getCollectionName(id: string, named: NamedCollection[]): string {
  return id === PERSONAL_COLLECTION_ID ? 'Personal' : named.find((c) => c.id === id)?.name || 'collection';
}

export interface ExecuteTransferParams {
  fromId: string;
  toId: string;
  moves: Record<string, number>;
  personalCards: Record<string, number>;
  named: NamedCollection[];
  applyPersonal: (next: Record<string, number>) => void;
  pricesFor: (coll: NamedCollection, defaults: ListDefaults, cards: Record<string, number>) => Record<string, number>;
  onToast: (msg: string, type?: 'success' | 'error') => void;
  successMessage?: string;
}

/**
 * Performs a safe two-phase transfer of cards between collections:
 * 1. Increment copies in the destination collection (with pricing if always_list).
 * 2. Decrement copies in the source collection.
 * If the source update fails after target succeeded, alerts the user.
 */
export async function executeCollectionTransfer({
  fromId,
  toId,
  moves,
  personalCards,
  named,
  applyPersonal,
  pricesFor,
  onToast,
  successMessage,
}: ExecuteTransferParams): Promise<boolean> {
  const moveEntries = Object.entries(moves).filter(([, n]) => n > 0);
  if (moveEntries.length === 0 || !toId || toId === fromId) return false;

  const target = named.find((c) => c.id === toId) || null;
  const cardsOf = (id: string) => getCardsOfCollection(id, personalCards, named);
  const nameOf = (id: string) => getCollectionName(id, named);

  // 1. Target first
  const toCards = { ...cardsOf(toId) };
  for (const [key, n] of moveEntries) {
    toCards[key] = (toCards[key] || 0) + n;
  }

  if (toId === PERSONAL_COLLECTION_ID) {
    applyPersonal(toCards);
  } else {
    const prices = target?.always_list ? pricesFor(target, target.list_defaults, moves) : {};
    const success = await setCollectionCards(toId, toCards, prices);
    if (!success) return false;
  }

  // 2. Source second
  const fromCards = { ...cardsOf(fromId) };
  for (const [key, n] of moveEntries) {
    const left = (fromCards[key] || 0) - n;
    if (left > 0) fromCards[key] = left;
    else delete fromCards[key];
  }

  if (fromId === PERSONAL_COLLECTION_ID) {
    applyPersonal(fromCards);
  } else {
    const success = await setCollectionCards(fromId, fromCards);
    if (!success) {
      onToast(
        `The copies were added to ${nameOf(toId)}, but ${nameOf(fromId)} couldn't be updated - lower it by hand.`,
        'error'
      );
      return false;
    }
  }

  if (successMessage) {
    onToast(successMessage, 'success');
  }
  return true;
}
