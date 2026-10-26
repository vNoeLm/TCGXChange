import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useExitTransition } from '../lib/useExitTransition';

export interface ImageViewerProps {
  src?: string;
  alt?: string;
  open: boolean;
  onClose: () => void;
  landscapeCard?: boolean;
  images?: string[];
  currentIndex?: number;
  onIndexChange?: (index: number) => void;
}

export type CardImageViewerProps = ImageViewerProps;

/**
 * Universal fullscreen image viewer with smooth exit animation, image rotation (R),
 * multi-image navigation (Left/Right arrows), and high-resolution centering.
 * Esc or the close button closes it.
 */
export function ImageViewer({
  src,
  alt = 'Image preview',
  open,
  onClose,
  landscapeCard = false,
  images,
  currentIndex = 0,
  onIndexChange,
}: ImageViewerProps) {
  const [turns, setTurns] = useState(0);
  const [storedSideways, setStoredSideways] = useState(false);
  const [activeIdx, setActiveIdx] = useState(currentIndex);
  const imgRef = useRef<HTMLImageElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const anim = useExitTransition(open, 200);
  const reduceMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    setActiveIdx(currentIndex);
  }, [currentIndex]);

  const activeSrc = (images && images.length > 0)
    ? (images[activeIdx] || images[0] || src || '')
    : (src || '');

  useEffect(() => {
    if (!open) return;
    setTurns(0);
  }, [open, activeSrc]);

  const checkStored = (img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth) {
      setStoredSideways(landscapeCard && img.naturalHeight > img.naturalWidth);
    }
  };

  useEffect(() => {
    if (anim.rendered) checkStored(imgRef.current);
  }, [anim.rendered, activeSrc, landscapeCard]);

  useEffect(() => {
    if (open && anim.rendered) closeRef.current?.focus();
  }, [open, anim.rendered]);

  const goToPrev = useCallback(() => {
    if (!images || images.length <= 1) return;
    const nextIdx = activeIdx > 0 ? activeIdx - 1 : images.length - 1;
    setActiveIdx(nextIdx);
    onIndexChange?.(nextIdx);
  }, [images, activeIdx, onIndexChange]);

  const goToNext = useCallback(() => {
    if (!images || images.length <= 1) return;
    const nextIdx = activeIdx < images.length - 1 ? activeIdx + 1 : 0;
    setActiveIdx(nextIdx);
    onIndexChange?.(nextIdx);
  }, [images, activeIdx, onIndexChange]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'r' || e.key === 'R') {
        setTurns((t) => t + 1);
      } else if (e.key === 'ArrowLeft') {
        goToPrev();
      } else if (e.key === 'ArrowRight') {
        goToNext();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose, goToPrev, goToNext]);

  if (!anim.rendered || typeof document === 'undefined' || !activeSrc) return null;

  const rotation = (storedSideways ? 90 : 0) + turns * 90;
  const sideways = Math.abs(rotation / 90) % 2 === 1;
  const btn = 'h-11 px-4 rounded-full border flex items-center gap-2 text-sm font-bold cursor-pointer transition hover:brightness-110 active:scale-95 select-none shadow-xl';
  const btnStyle = { background: 'rgba(15,23,42,0.85)', borderColor: 'rgba(255,255,255,0.18)', color: '#f8fafc' };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${alt} - full view`}
      data-state={anim.state}
      className="tv-overlay fixed inset-0 z-[10001] flex items-center justify-center overflow-hidden pt-4 pb-20 select-none"
      style={{ background: 'rgba(0,0,0,0.92)' }}
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <img
        src={activeSrc}
        alt={alt}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        ref={imgRef}
        onLoad={(e) => checkStored(e.currentTarget)}
        className="shrink-0 select-none rounded-xl shadow-2xl cursor-zoom-out"
        style={{
          maxWidth: sideways ? 'calc(100vh - 7rem)' : 'calc(100vw - 2rem)',
          maxHeight: sideways ? 'calc(100vw - 2rem)' : 'calc(100vh - 7rem)',
          transform: `rotate(${rotation}deg)`,
          transition: reduceMotion ? 'none' : 'transform 250ms var(--ease-out)',
        }}
        draggable={false}
      />

      {/* Prev / Next floating edge buttons when multiple images exist */}
      {images && images.length > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              goToPrev();
            }}
            aria-label="Previous image"
            className="fixed left-3 sm:left-6 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full border flex items-center justify-center transition hover:scale-110 active:scale-95 cursor-pointer text-white shadow-2xl z-[10002]"
            style={btnStyle}
            title="Previous (Left Arrow)"
          >
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              goToNext();
            }}
            aria-label="Next image"
            className="fixed right-3 sm:right-6 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full border flex items-center justify-center transition hover:scale-110 active:scale-95 cursor-pointer text-white shadow-2xl z-[10002]"
            style={btnStyle}
            title="Next (Right Arrow)"
          >
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </>
      )}

      {/* Bottom controls bar */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="fixed bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-2.5 z-[10002]"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {images && images.length > 1 && (
          <div
            className="h-11 px-4 rounded-full border flex items-center justify-center text-xs font-mono font-bold select-none shadow-xl"
            style={btnStyle}
          >
            {activeIdx + 1} / {images.length}
          </div>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setTurns((t) => t + 1);
          }}
          className={btn}
          style={btnStyle}
          title="Rotate (R)"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12a9 9 0 11-3-6.7" />
            <polyline points="21 3 21 9 15 9" />
          </svg>
          Rotate
        </button>
        <button
          ref={closeRef}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className={btn}
          style={btnStyle}
          title="Close (Esc)"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
          Close
        </button>
      </div>
    </div>,
    document.body
  );
}

export const CardImageViewer = ImageViewer;
