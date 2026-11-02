import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { CardDetail } from './CardDetail';
import { useExitTransition } from '../lib/useExitTransition';
import { useBodyScrollLock } from '../lib/scrollLock';
import { backdropCloseProps } from '../lib/modalBackdrop';

interface CardPreviewOverlayProps {
  /** Exactly one of these should be set - whichever this page already keys its preview by. */
  cardId?: string | null;
  inventoryId?: string | null;
  onClose: () => void;
  /** Higher when this preview needs to sit above another modal already open on the page
   * (e.g. a stats modal). Defaults to the value nearly every call site already used. */
  zIndex?: number;
}

/**
 * The full-screen CardDetail preview used from the catalog, binder, decks, deck builder,
 * marketplace and deck statistics - one shared implementation instead of six near-identical
 * copies of the same backdrop/panel markup, so the motion and styling can't drift between them.
 *
 * The id going null closes it; the last id is kept around for the length of the exit transition
 * so CardDetail doesn't unmount (and lose its own fetched data) mid-fade.
 */
export function CardPreviewOverlay({ cardId, inventoryId, onClose, zIndex = 9999 }: CardPreviewOverlayProps) {
  const id = cardId ?? inventoryId ?? null;
  const lastRef = useRef<{ cardId?: string | null; inventoryId?: string | null }>({});
  if (id) lastRef.current = { cardId, inventoryId };
  useBodyScrollLock(Boolean(id));
  const { rendered, state } = useExitTransition(!!id, 250);

  if (!rendered) return null;

  const content = (
    <div
      {...backdropCloseProps(onClose, { stopPropagation: true })}
      data-state={state}
      className="tv-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.85)',
        padding: 12,
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        willChange: 'opacity',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        data-state={state}
        className="tv-modal-panel w-full max-w-6xl 2xl:max-w-[1680px] my-auto relative rounded-2xl sm:rounded-3xl overflow-hidden max-h-[94vh] overflow-y-auto custom-scrollbar"
        style={{
          touchAction: 'auto',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          boxShadow: '0 25px 60px rgba(0,0,0,0.9), 0 0 30px var(--accent-glow)',
          willChange: 'transform, opacity',
        }}
      >
        <CardDetail cardId={lastRef.current.cardId ?? undefined} inventoryId={lastRef.current.inventoryId ?? undefined} onClose={onClose} />
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(content, document.body) : content;
}
