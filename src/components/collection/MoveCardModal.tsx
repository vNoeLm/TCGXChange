import { useEffect, useState } from 'react';
import { CollectionModal } from './CollectionModal';
import { type ListDefaults, type NamedCollection } from '../../lib/collectionDefaults';
import { useCollectionsStore } from '../../lib/collectionsStore';
import {
  executeCollectionTransfer,
  getCardsOfCollection,
  getCollectionName,
  getCollectionOptions,
} from '../../lib/collectionTransfer';

const selectCls = 'w-full h-9 rounded-lg px-3 text-xs font-bold border outline-none cursor-pointer focus:border-[var(--accent)]';
const fieldStyle = { background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' };
const labelCls = 'text-[10px] font-bold uppercase tracking-wider';

/**
 * Moves an exact number of copies of ONE card from one collection to another. The bulk
 * "Move cards" modal handles whole-collection moves; this is for precise control of a single card
 * (e.g. move 2 of my 5 copies to Inventory).
 */
export function MoveCardModal({
  open,
  onClose,
  card,
  hasFoil,
  initialFoil = false,
  sourceId,
  personalCards,
  applyPersonal,
  pricesFor,
  onToast,
}: {
  open: boolean;
  onClose: () => void;
  card: { id: string; name: string } | null;
  /** Whether the card has a separate foil print. */
  hasFoil: boolean;
  initialFoil?: boolean;
  /** The collection the catalog is showing - the default source. */
  sourceId: string;
  personalCards: Record<string, number>;
  applyPersonal: (next: Record<string, number>) => void;
  pricesFor: (coll: NamedCollection, defaults: ListDefaults, cards: Record<string, number>) => Record<string, number>;
  onToast: (msg: string, type?: 'success' | 'error') => void;
}) {
  const store = useCollectionsStore();
  const named = store.collections;
  const [fromId, setFromId] = useState(sourceId);
  const [toId, setToId] = useState('');
  const [foil, setFoil] = useState(initialFoil);
  const [amount, setAmount] = useState(1);
  const [moving, setMoving] = useState(false);

  const options = getCollectionOptions(named);
  const cardsOf = (id: string) => getCardsOfCollection(id, personalCards, named);
  const nameOf = (id: string) => getCollectionName(id, named);
  const target = named.find((c) => c.id === toId) || null;
  const key = card ? (foil ? `${card.id}_foil` : card.id) : '';
  const available = key ? cardsOf(fromId)[key] || 0 : 0;

  useEffect(() => {
    if (!open) return;
    setFromId(sourceId);
    setFoil(initialFoil && hasFoil);
    setAmount(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, card?.id]);

  // Default target: the first collection that is not the source (prefer an inventory-like one).
  useEffect(() => {
    if (!open) return;
    if (toId && toId !== fromId && options.some((o) => o.id === toId)) return;
    const others = options.filter((o) => o.id !== fromId);
    const guess = others.find((o) => /inventory|stock|sale|trade/i.test(o.name)) || others[0];
    setToId(guess ? guess.id : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fromId, named]);

  // Keep the amount inside what the source actually holds.
  useEffect(() => {
    setAmount((a) => Math.max(1, Math.min(a, Math.max(1, available))));
  }, [available]);

  const run = async () => {
    if (!card || !toId || toId === fromId || available < 1) return;
    const n = Math.max(1, Math.min(amount, available));
    setMoving(true);
    try {
      const ok = await executeCollectionTransfer({
        fromId,
        toId,
        moves: { [key]: n },
        personalCards,
        named,
        applyPersonal,
        pricesFor,
        onToast,
        successMessage: `Moved ${n}x ${card.name}${foil ? ' (foil)' : ''} to ${nameOf(toId)}.`,
      });
      if (ok) onClose();
    } finally {
      setMoving(false);
    }
  };

  return (
    <CollectionModal
      open={open}
      onClose={onClose}
      title="Move copies"
      subtitle={card ? `Move an exact number of ${card.name} between collections` : ''}
      maxWidth="max-w-md"
      closeDisabled={moving}
    >
      {named.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Create a second collection first (for example "Inventory") under New / manage collections, then move copies into it here.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2.5">
            <label className="flex flex-col gap-1">
              <span className={labelCls} style={{ color: 'var(--text-tertiary)' }}>From</span>
              <select value={fromId} onChange={(e) => setFromId(e.target.value)} className={selectCls} style={fieldStyle}>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>{o.name} ({cardsOf(o.id)[key] || 0})</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelCls} style={{ color: 'var(--text-tertiary)' }}>To</span>
              <select value={toId} onChange={(e) => setToId(e.target.value)} className={selectCls} style={fieldStyle}>
                {options.filter((o) => o.id !== fromId).map((o) => (
                  <option key={o.id} value={o.id}>{o.name} ({cardsOf(o.id)[key] || 0})</option>
                ))}
              </select>
            </label>
          </div>

          {hasFoil && (
            <div className="flex gap-1.5">
              {[{ f: false, label: 'Normal' }, { f: true, label: 'Foil' }].map((o) => (
                <button
                  key={o.label}
                  type="button"
                  onClick={() => setFoil(o.f)}
                  className="h-7 px-3 rounded-lg border text-[11px] font-bold cursor-pointer"
                  style={foil === o.f
                    ? { background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }
                    : { background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}

          <label className="flex flex-col gap-1">
            <span className={labelCls} style={{ color: 'var(--text-tertiary)' }}>
              How many to move ({available} in {nameOf(fromId)})
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="One less"
                onClick={() => setAmount((a) => Math.max(1, a - 1))}
                disabled={available < 1 || amount <= 1}
                className="w-9 h-9 rounded-lg border text-sm font-black cursor-pointer disabled:opacity-40"
                style={fieldStyle}
              >
                -
              </button>
              <input
                type="number"
                min={1}
                max={Math.max(1, available)}
                value={available < 1 ? 0 : amount}
                disabled={available < 1}
                onChange={(e) => setAmount(Math.max(1, Math.min(available, Math.round(Number(e.target.value) || 1))))}
                className="w-20 h-9 rounded-lg px-3 text-xs font-bold border outline-none text-center"
                style={fieldStyle}
              />
              <button
                type="button"
                aria-label="One more"
                onClick={() => setAmount((a) => Math.min(available, a + 1))}
                disabled={available < 1 || amount >= available}
                className="w-9 h-9 rounded-lg border text-sm font-black cursor-pointer disabled:opacity-40"
                style={fieldStyle}
              >
                +
              </button>
              <button
                type="button"
                onClick={() => setAmount(Math.max(1, available))}
                disabled={available < 1}
                className="h-9 px-3 rounded-lg border text-[11px] font-bold cursor-pointer disabled:opacity-40"
                style={fieldStyle}
              >
                All
              </button>
            </div>
          </label>

          {available < 1 && (
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {nameOf(fromId)} has no {foil ? 'foil ' : ''}copies of this card.
            </p>
          )}
          {target?.always_list && available >= 1 && (
            <p className="text-[11px]" style={{ color: 'var(--positive)' }}>
              "{target.name}" is always listed - these go on the marketplace at its default condition, price and delivery methods.
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={moving} className="h-9 px-4 rounded-lg text-xs font-semibold border cursor-pointer" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
              Cancel
            </button>
            <button
              type="button"
              onClick={run}
              disabled={moving || available < 1 || !toId}
              className="h-9 px-5 rounded-lg text-xs font-black cursor-pointer disabled:opacity-50 disabled:cursor-default"
              style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
            >
              {moving ? 'Moving...' : `Move ${available < 1 ? '' : amount} ${amount === 1 ? 'copy' : 'copies'}`.replace('  ', ' ')}
            </button>
          </div>
        </div>
      )}
    </CollectionModal>
  );
}
